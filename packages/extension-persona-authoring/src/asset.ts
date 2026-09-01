import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath, rename, rm, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ToolInvocationError } from '@doppelganger/doppelganger-protocols'
import type { PersonaAssetRevision } from '@doppelganger/doppelganger-persona'

export interface PersonaAssetFile {
  readonly filename: string
  readonly url: string
  readonly bytes: Uint8Array
  readonly revision: PersonaAssetRevision
  readonly mode: number
}

export interface InspectedPersonaAsset extends PersonaAssetFile {
  readonly content: string
}

function revision(bytes: Uint8Array): PersonaAssetRevision {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function assetError(code: string, message: string): ToolInvocationError {
  return new ToolInvocationError(code, message)
}

async function readBounded(handle: FileHandle, maximumBytes: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(maximumBytes + 1)
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset > maximumBytes) {
    throw assetError('PERSONA_ASSET_TOO_LARGE', `Persona asset exceeds the ${maximumBytes}-byte limit`)
  }
  return buffer.subarray(0, offset)
}

function decodeContent(bytes: Uint8Array): string {
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw assetError('PERSONA_ASSET_UNSAFE', 'Persona asset is not valid UTF-8')
  }
  if (content.trim().length === 0) {
    throw assetError('PERSONA_ASSET_UNSAFE', 'Persona asset must contain non-whitespace content')
  }
  return content
}

export async function readPersonaAssetFile(
  filename: string,
  maximumBytes: number,
): Promise<PersonaAssetFile> {
  let metadata
  try {
    metadata = await lstat(filename, { bigint: true })
  } catch {
    throw assetError('PERSONA_ASSET_UNSAFE', 'Persona asset is unavailable')
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw assetError('PERSONA_ASSET_UNSAFE', 'Persona asset must be a regular non-symbolic-link file')
  }
  if (metadata.size > BigInt(maximumBytes)) {
    throw assetError('PERSONA_ASSET_TOO_LARGE', `Persona asset exceeds the ${maximumBytes}-byte limit`)
  }

  let handle: FileHandle
  try {
    handle = await open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch {
    throw assetError('PERSONA_ASSET_UNSAFE', 'Persona asset cannot be opened safely')
  }
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
      throw assetError('PERSONA_ASSET_UNSAFE', 'Persona asset changed while it was opened')
    }
    const bytes = await readBounded(handle, maximumBytes)
    const observed = await handle.stat({ bigint: true })
    if (observed.dev !== opened.dev || observed.ino !== opened.ino || observed.size !== opened.size
      || observed.mtimeNs !== opened.mtimeNs || observed.ctimeNs !== opened.ctimeNs) {
      throw assetError('PERSONA_ASSET_UNSAFE', 'Persona asset changed while it was read')
    }
    const canonicalPath = await realpath(filename)
    return Object.freeze({
      filename,
      url: pathToFileURL(canonicalPath).href,
      bytes,
      revision: revision(bytes),
      mode: Number(opened.mode & 0o7777n),
    })
  } finally {
    await handle.close()
  }
}

export async function inspectPersonaAsset(
  filename: string,
  maximumBytes: number,
): Promise<InspectedPersonaAsset> {
  const file = await readPersonaAssetFile(filename, maximumBytes)
  return Object.freeze({ ...file, content: decodeContent(file.bytes) })
}

async function syncDirectory(path: string): Promise<void> {
  let directory: FileHandle | undefined
  try {
    directory = await open(path, fsConstants.O_RDONLY)
    await directory.sync()
  } catch {
    // The target rename is already atomic; directory sync is best-effort on platforms that support it.
  } finally {
    await directory?.close()
  }
}

export async function replacePersonaAsset(
  filename: string,
  bytes: Uint8Array,
  mode: number,
): Promise<void> {
  const directory = dirname(filename)
  const temporary = join(directory, `.${basename(filename)}.doppelganger-${randomUUID()}.tmp`)
  let handle: FileHandle | undefined
  try {
    handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
    await handle.writeFile(bytes)
    await handle.chmod(mode)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, filename)
    await syncDirectory(directory)
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export function encodeReplacement(content: string, maximumBytes: number): Uint8Array {
  if (content.toWellFormed() !== content) {
    throw new ToolInvocationError('INVALID_INPUT', 'replacement must be valid Unicode text')
  }
  const bytes = new TextEncoder().encode(content)
  if (bytes.length > maximumBytes) {
    throw new ToolInvocationError(
      'PERSONA_ASSET_TOO_LARGE',
      `replacement exceeds the ${maximumBytes}-byte limit`,
    )
  }
  if (content.trim().length === 0) {
    throw new ToolInvocationError('INVALID_INPUT', 'replacement must contain non-whitespace content')
  }
  return bytes
}

export function personaAssetRevision(bytes: Uint8Array): PersonaAssetRevision {
  return revision(bytes)
}
