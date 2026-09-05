import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeLogRecord } from '@doppelganger/doppelganger-composition-runtime'
import {
  createFileLoggingFilter,
  normalizeFileLoggingConfig,
  RollingJsonlWriter,
  type NormalizedFileLoggingConfig,
} from '../src/index.ts'

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-logging-file-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function config(path: string, overrides: Partial<NormalizedFileLoggingConfig> = {}): NormalizedFileLoggingConfig {
  return normalizeFileLoggingConfig({
    path,
    level: 'debug',
    levels: {},
    maxBytes: 64 * 1024,
    maxFiles: 2,
    maximumPendingRecords: 16,
    ...overrides,
  })
}

function record(sequence: number, message = `record ${sequence}`, logger = 'file-test', severity: RuntimeLogRecord['severity'] = 'info'): RuntimeLogRecord {
  return Object.freeze({
    sequence,
    timestamp: 1_700_000_000_000 + sequence,
    severity,
    logger,
    message,
    sessionId: 'file-session',
    runtimePresetId: 'file-preset',
  })
}

async function jsonLines(path: string): Promise<RuntimeLogRecord[]> {
  const text = await readFile(path, 'utf8')
  return text.trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line) as RuntimeLogRecord)
}

describe('file logging configuration', () => {
  it('rejects unknown fields, invalid bounds, invalid levels, and non-normalized paths', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'runtime.jsonl')

    expect(() => normalizeFileLoggingConfig({ path, unknown: true })).toThrow('unknown field')
    expect(() => normalizeFileLoggingConfig({ path, level: 'trace' })).toThrow('error, warn, info, or debug')
    expect(() => normalizeFileLoggingConfig({ path, maxBytes: 1 })).toThrow('maxBytes')
    expect(() => normalizeFileLoggingConfig({ path, maxFiles: 0 })).toThrow('maxFiles')
    expect(() => normalizeFileLoggingConfig({ path, maximumPendingRecords: 0 })).toThrow('maximumPendingRecords')
    expect(() => normalizeFileLoggingConfig({ path: 'relative.jsonl' })).toThrow('must be absolute')
    expect(() => normalizeFileLoggingConfig({ path: `${root}/nested/../runtime.jsonl` })).toThrow('must be normalized')
    expect(() => normalizeFileLoggingConfig({ path, levels: { '': 'debug' } })).toThrow('non-empty exact names')
  })

  it('applies exact logger overrides before destination queueing', async () => {
    const root = await temporaryRoot()
    const filter = createFileLoggingFilter(config(join(root, 'runtime.jsonl'), {
      level: 'error',
      levels: Object.freeze({ verbose: 'debug' }),
    }))

    expect(filter(record(1, 'accepted', 'verbose', 'debug'))).toBe(true)
    expect(filter(record(2, 'rejected', 'other', 'debug'))).toBe(false)
    expect(filter(record(3, 'accepted error', 'other', 'error'))).toBe(true)
  })

  it('exposes public and Loader entries with only the composition runtime internal edge', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      readonly exports: Record<string, unknown>
      readonly dependencies: Record<string, string>
    }
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './loader'])
    expect(Object.keys(manifest.dependencies).filter(name => name.startsWith('@doppelganger/'))).toEqual([
      '@doppelganger/doppelganger-composition-runtime',
    ])
  })
})

describe('rolling JSONL writer', () => {
  it('appends ordered complete JSONL records at an explicit absolute path', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'nested', 'runtime.jsonl')
    const writer = await RollingJsonlWriter.open(config(path))

    await Promise.all([writer.write(record(1)), writer.write(record(2)), writer.write(record(3))])
    await writer.close()

    expect(await jsonLines(path)).toEqual([record(1), record(2), record(3)])
    expect((await readFile(path, 'utf8')).endsWith('\n')).toBe(true)
  })

  it('rejects relative directory symlink and unsupported destination paths', async () => {
    const root = await temporaryRoot()
    await expect(RollingJsonlWriter.open(config(root))).rejects.toThrow('regular file')

    const target = join(root, 'target.jsonl')
    const link = join(root, 'link.jsonl')
    await writeFile(target, '')
    await symlink(target, link)
    await expect(RollingJsonlWriter.open(config(link))).rejects.toThrow('symbolic link')

    const socketPath = join(root, 'runtime.sock')
    const server = createServer()
    server.listen(socketPath)
    await once(server, 'listening')
    await expect(RollingJsonlWriter.open(config(socketPath))).rejects.toThrow('regular file')
    server.close()
    await once(server, 'close')
  })

  it('rejects a second process-local writer for the same active path', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'runtime.jsonl')
    const writer = await RollingJsonlWriter.open(config(path))

    await expect(RollingJsonlWriter.open(config(path))).rejects.toThrow('already has an active writer')
    await writer.close()
    const reopened = await RollingJsonlWriter.open(config(path))
    expect(reopened).toBeInstanceOf(RollingJsonlWriter)
    await reopened.close()
  })

  it('rotates before the threshold-crossing record and retains exact generations', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'runtime.jsonl')
    const writer = await RollingJsonlWriter.open(config(path, { maxFiles: 2 }))
    const large = 'x'.repeat(16 * 1024)

    for (let sequence = 1; sequence <= 10; sequence += 1) await writer.write(record(sequence, `${sequence}:${large}`))
    await writer.close()

    const active = await jsonLines(path)
    const first = await jsonLines(`${path}.1`)
    const second = await jsonLines(`${path}.2`)
    expect(active.map(item => item.sequence)).toEqual([10])
    expect(first.map(item => item.sequence)).toEqual([7, 8, 9])
    expect(second.map(item => item.sequence)).toEqual([4, 5, 6])
    await expect(readFile(`${path}.3`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('permits one bounded record in an empty file even when serialized overhead crosses maxBytes', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'runtime.jsonl')
    const writer = await RollingJsonlWriter.open(config(path))
    const oversized = record(1, 'x'.repeat(64 * 1024))

    await writer.write(oversized)
    await writer.close()

    expect((await jsonLines(path))[0]).toEqual(oversized)
    await expect(readFile(`${path}.1`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('contains operational filesystem failure and stops the failed sink', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'runtime.jsonl')
    const writer = await RollingJsonlWriter.open(config(path, { maxFiles: 1 }))
    await writer.write(record(1, 'x'.repeat(40 * 1024)))
    await mkdir(`${path}.1`)

    await expect(writer.write(record(2, 'y'.repeat(40 * 1024)))).rejects.toBeDefined()
    await expect(writer.write(record(3))).rejects.toThrow('not accepting records')
    await expect(writer.close()).resolves.toBeUndefined()
  })

  it('drains accepted writes and closes the file exactly once on disposal', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'runtime.jsonl')
    const writer = await RollingJsonlWriter.open(config(path))
    const writes = Array.from({ length: 50 }, (_, index) => writer.write(record(index + 1)))

    await Promise.all([writer.close(), writer.close(), ...writes])

    expect((await jsonLines(path)).map(item => item.sequence)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1))
    await expect(writer.write(record(51))).rejects.toThrow('not accepting records')
  })
})
