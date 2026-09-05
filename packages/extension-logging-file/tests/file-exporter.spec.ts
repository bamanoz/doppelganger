import { once } from 'node:events'
import { createServer } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  RuntimeLoggingService,
  RuntimeLogRecord,
  RuntimeLogSink,
  RuntimeLogSinkOptions,
} from '@doppelganger/doppelganger-composition-runtime'
import {
  FileLoggingConfigSchema,
  FileLoggingPlugin,
  createFileLoggingFilter,
  normalizeFileLoggingConfig,
  resolveFileLoggingConfig,
  RollingJsonlWriter,
  type ResolvedFileLoggingConfig,
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

const runtimeActivationId = '123e4567-e89b-42d3-a456-426614174000'
const loggingScope = Object.freeze({
  runtimeActivationId,
  sessionId: 'file-session',
  runtimePresetId: 'file-preset',
})

function config(path: string, overrides: Partial<ResolvedFileLoggingConfig> = {}): ResolvedFileLoggingConfig {
  return resolveFileLoggingConfig(normalizeFileLoggingConfig({
    path,
    level: 'debug',
    levels: {},
    maxBytes: 64 * 1024,
    maxFiles: 2,
    maximumPendingRecords: 16,
    ...overrides,
  }), loggingScope)
}

function record(sequence: number, message = `record ${sequence}`, logger = 'file-test', severity: RuntimeLogRecord['severity'] = 'info'): RuntimeLogRecord {
  return Object.freeze({
    runtimeActivationId,
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
  it('rejects unknown fields, invalid bounds, invalid levels, and invalid path forms', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'runtime.jsonl')
    const template = join(root, 'runtime-{runtimeActivationId}.jsonl')

    expect(() => normalizeFileLoggingConfig({ path, unknown: true })).toThrow('unknown field')
    expect(() => normalizeFileLoggingConfig({ path, level: 'trace' })).toThrow('error, warn, info, or debug')
    expect(() => normalizeFileLoggingConfig({ path, maxBytes: 1 })).toThrow('maxBytes')
    expect(() => normalizeFileLoggingConfig({ path, maxFiles: 0 })).toThrow('maxFiles')
    expect(() => normalizeFileLoggingConfig({ path, maximumPendingRecords: 0 })).toThrow('maximumPendingRecords')
    expect(() => normalizeFileLoggingConfig({})).toThrow('exactly one of path or pathTemplate')
    expect(() => normalizeFileLoggingConfig({ path, pathTemplate: template })).toThrow('exactly one of path or pathTemplate')
    expect(() => normalizeFileLoggingConfig({ path: 'relative.jsonl' })).toThrow('must be absolute')
    expect(() => normalizeFileLoggingConfig({ path: `${root}/nested/../runtime.jsonl` })).toThrow('must be normalized')
    expect(() => normalizeFileLoggingConfig({ pathTemplate: join(root, 'runtime.jsonl') })).toThrow('exactly one')
    expect(() => normalizeFileLoggingConfig({ pathTemplate: join(root, 'runtime-{runtimeActivationId}-{runtimeActivationId}.jsonl') })).toThrow('exactly one')
    expect(() => normalizeFileLoggingConfig({ pathTemplate: join(root, 'runtime-{sessionId}-{runtimeActivationId}.jsonl') })).toThrow('supports only')
    expect(() => normalizeFileLoggingConfig({ pathTemplate: join(root, 'runtime-{runtimeActivationId.jsonl') })).toThrow('exactly one')
    expect(() => normalizeFileLoggingConfig({ path, levels: { '': 'debug' } })).toThrow('non-empty exact names')
  })

  it('uses identical direct and Loader file configuration admission', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'parity.jsonl')
    const template = join(root, 'runtime-{runtimeActivationId}.jsonl')
    const valid = [
      { path },
      {
        pathTemplate: join(root, 'runtime-{runtimeActivationId}.jsonl'),
        level: 'debug',
        levels: { worker: 'warn' },
        maxBytes: 64 * 1024,
        maxFiles: 100,
        maximumPendingRecords: 1,
        retention: {},
      },
      {
        pathTemplate: join(root, 'bounded-{runtimeActivationId}.jsonl'),
        retention: {
          maxAgeDays: 3_650,
          maxTotalBytes: Number.MAX_SAFE_INTEGER,
          cleanupIntervalMs: 86_400_000,
        },
      },
    ] as const
    for (const input of valid) {
      const direct = normalizeFileLoggingConfig(input)
      const admitted = FileLoggingConfigSchema['~standard'].validate(input)
      expect('issues' in admitted ? admitted.issues : undefined).toBeUndefined()
      if ('value' in admitted) expect(admitted.value).toEqual(direct)
    }
    expect(normalizeFileLoggingConfig({ path })).toEqual({
      path,
      level: 'info',
      levels: {},
      maxBytes: 10 * 1024 * 1024,
      maxFiles: 5,
      maximumPendingRecords: 2_048,
    })
    expect(normalizeFileLoggingConfig({
      pathTemplate: join(root, 'retained-{runtimeActivationId}.jsonl'),
      retention: {},
    })).toMatchObject({
      retention: {
        maxAgeDays: 7,
        maxTotalBytes: 512 * 1024 * 1024,
        cleanupIntervalMs: 60_000,
      },
    })

    const invalid = [
      null,
      { path, unknown: true },
      { path: `${root}/${'x'.repeat(4_096)}` },
      { pathTemplate: `${root}/${'x'.repeat(4_096)}-{runtimeActivationId}` },
      { path, pathTemplate: join(root, 'runtime-{runtimeActivationId}.jsonl') },
      { path, level: 'trace' },
      { path, levels: { worker: null } },
      { path, maxBytes: 65_535 },
      { path, maximumPendingRecords: 16_385 },
      { pathTemplate: template, retention: null },
      { pathTemplate: template, retention: { unknown: true } },
      { pathTemplate: template, retention: { maxAgeDays: 0 } },
      { pathTemplate: template, retention: { maxAgeDays: 3_651 } },
      { pathTemplate: template, retention: { maxTotalBytes: 65_535 } },
      { pathTemplate: template, retention: { maxTotalBytes: Number.MAX_SAFE_INTEGER + 1 } },
      { pathTemplate: template, retention: { cleanupIntervalMs: 999 } },
      { pathTemplate: template, retention: { cleanupIntervalMs: 86_400_001 } },
      { path, retention: {} },
      { pathTemplate: join(root, '{runtimeActivationId}', 'runtime.jsonl'), retention: {} },
    ]
    for (const input of invalid) {
      expect(() => normalizeFileLoggingConfig(input)).toThrow()
      expect(FileLoggingConfigSchema['~standard'].validate(input)).toHaveProperty('issues')
    }
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resolves one activation placeholder while preserving static paths', async () => {
    const root = await temporaryRoot()
    const staticPath = join(root, 'static.jsonl')
    const template = join(root, 'runtime-{runtimeActivationId}.jsonl')
    const normalizedStatic = normalizeFileLoggingConfig({ path: staticPath })
    const normalizedTemplate = normalizeFileLoggingConfig({ pathTemplate: template })
    const normalizedRetention = normalizeFileLoggingConfig({ pathTemplate: template, retention: {} })

    expect(resolveFileLoggingConfig(normalizedStatic, loggingScope)).not.toHaveProperty('pathTemplate')
    expect(resolveFileLoggingConfig(normalizedStatic, loggingScope).path).toBe(staticPath)
    expect(resolveFileLoggingConfig(normalizedTemplate, loggingScope)).not.toHaveProperty('pathTemplate')
    expect(resolveFileLoggingConfig(normalizedTemplate, loggingScope).path).toBe(join(root, `runtime-${runtimeActivationId}.jsonl`))
    expect(resolveFileLoggingConfig(normalizedRetention, loggingScope)).toMatchObject({
      path: join(root, `runtime-${runtimeActivationId}.jsonl`),
      pathTemplate: template,
      retention: {
        maxAgeDays: 7,
        maxTotalBytes: 512 * 1024 * 1024,
        cleanupIntervalMs: 60_000,
      },
    })
    expect(() => resolveFileLoggingConfig(normalizedTemplate, {
      ...loggingScope,
      runtimeActivationId: '../unsafe',
    })).toThrow('canonical lowercase UUID')
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

  it('keeps default-off retention cleanup compatible with close and reopen', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'runtime.jsonl')
    const writer = await RollingJsonlWriter.open(config(path))

    expect(writer.retentionStatus).toBeUndefined()
    await expect(writer.cleanup()).resolves.toBeUndefined()
    await writer.close()
    const reopened = await RollingJsonlWriter.open(config(path))
    await reopened.write(record(1))
    await reopened.close()

    expect(await jsonLines(path)).toEqual([record(1)])
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

describe('file logging Loader lifecycle', () => {
  it('schedules retained cleanup and clears it before exhaustive disposal', async () => {
    vi.useFakeTimers()
    const rootPath = await temporaryRoot()
    const pathTemplate = join(rootPath, 'runtime-{runtimeActivationId}.jsonl')
    const order: string[] = []
    const cleanup = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('maintenance failed'))
      .mockResolvedValue(undefined)
    const close = vi.fn(async () => { order.push('close') })
    const writer = {
      write: vi.fn<RuntimeLogSink['write']>(),
      cleanup,
      close,
      retentionStatus: undefined,
    } as unknown as RollingJsonlWriter
    const open = vi.spyOn(RollingJsonlWriter, 'open').mockResolvedValue(writer)
    let registeredSink: RuntimeLogSink | undefined
    let registeredOptions: RuntimeLogSinkOptions | undefined
    const logging: RuntimeLoggingService = {
      scope: loggingScope,
      register(sink, options) {
        registeredSink = sink
        registeredOptions = options
        return async () => { order.push('unregister') }
      },
    }
    const root = new Context().isolate('doppelgangerLogging')
    root.provide('doppelgangerLogging', logging)
    try {
      const fiber = root.plugin(FileLoggingPlugin, {
        pathTemplate,
        retention: { cleanupIntervalMs: 1_000 },
        maximumPendingRecords: 7,
      })
      await fiber.await()

      expect(open).toHaveBeenCalledWith(expect.objectContaining({
        path: join(rootPath, `runtime-${runtimeActivationId}.jsonl`),
        pathTemplate,
        retention: expect.objectContaining({ cleanupIntervalMs: 1_000 }),
      }))
      expect(registeredSink).toBe(writer)
      expect(registeredOptions?.maximumPendingRecords).toBe(7)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(cleanup).toHaveBeenCalledTimes(2)

      await Promise.all([fiber.dispose(), fiber.dispose()])
      expect(order).toEqual(['unregister', 'close'])
      await vi.advanceTimersByTimeAsync(2_000)
      expect(cleanup).toHaveBeenCalledTimes(2)
    } finally {
      try {
        await root.fiber.dispose()
      } finally {
        open.mockRestore()
        vi.useRealTimers()
      }
    }
  })

  it('closes the writer when sink registration fails after retained open', async () => {
    const rootPath = await temporaryRoot()
    const pathTemplate = join(rootPath, 'runtime-{runtimeActivationId}.jsonl')
    const close = vi.fn(async () => undefined)
    const writer = { write: vi.fn(), cleanup: vi.fn(), close, retentionStatus: undefined } as unknown as RollingJsonlWriter
    const open = vi.spyOn(RollingJsonlWriter, 'open').mockResolvedValue(writer)
    const logging: RuntimeLoggingService = {
      scope: loggingScope,
      register() {
        throw new Error('registration failed')
      },
    }
    const root = new Context().isolate('doppelgangerLogging')
    root.provide('doppelgangerLogging', logging)
    try {
      await expect(root.plugin(FileLoggingPlugin, {
        pathTemplate,
        retention: {},
      }).await()).rejects.toThrow('registration failed')
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      try {
        await root.fiber.dispose()
      } finally {
        open.mockRestore()
      }
    }
  })
})
