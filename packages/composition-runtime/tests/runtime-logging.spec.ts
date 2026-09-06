import { access, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CompositionActivationError,
  RUNTIME_LOGGING_LIMITS,
  RUNTIME_LOGGING_SERVICE,
  RuntimeLoggingRouter,
  createCompositionDefinition,
  createCompositionRuntime,
  createRuntimeSessionMetadata,
  runtimeLogLevelAllows,
  type CompositionDefinition,
  type RuntimeLogRecord,
  type RuntimeLogSink,
} from '../src/index.ts'

const temporaryRoots: string[] = []
const contextModule = fileURLToPath(new URL('../../extension-protocols/src/context-plugin.ts', import.meta.url))
const toolsModule = fileURLToPath(new URL('../../extension-protocols/src/tools-plugin.ts', import.meta.url))
const personaModule = fileURLToPath(new URL('../../extension-persona/src/index.ts', import.meta.url))
const personaAuthoringModule = fileURLToPath(new URL('../../extension-persona-authoring/src/index.ts', import.meta.url))
const sqliteModule = fileURLToPath(new URL('../../extension-sqlite/src/index.ts', import.meta.url))
const memoryModule = fileURLToPath(new URL('../../extension-memory/src/index.ts', import.meta.url))
const memoryCaptureModule = fileURLToPath(new URL('../../extension-memory/src/capture.ts', import.meta.url))
const inferenceModule = fileURLToPath(new URL('../../extension-inference-pi/src/plugin.ts', import.meta.url))
const evolutionModule = fileURLToPath(new URL('../../extension-evolution/src/index.ts', import.meta.url))
const dynamicModule = fileURLToPath(new URL('../../extension-dynamic-runtime-plugins/src/plugin.ts', import.meta.url))
const codegraphModule = fileURLToPath(new URL('../../extension-codegraph/src/plugin.ts', import.meta.url))
const mcpModule = fileURLToPath(new URL('../../extension-mcp/src/plugin.ts', import.meta.url))
const embeddingModule = fileURLToPath(new URL('../../extension-embedding-local/src/plugin.ts', import.meta.url))
const vectorModule = fileURLToPath(new URL('../../extension-memory-vectors/src/index.ts', import.meta.url))
const sqliteVectorModule = fileURLToPath(new URL('../../extension-memory-vectors/src/sqlite-exact-plugin.ts', import.meta.url))
const protocolsModuleUrl = new URL('../../extension-protocols/src/index.ts', import.meta.url).href

afterEach(async () => {
  globalThis.__runtimeLoggingRecords = undefined
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

declare global {
  var __runtimeLoggingRecords: RuntimeLogRecord[] | undefined
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for runtime logging condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function eventQueue<T>() {
  const queued: T[] = []
  const waiters: Array<{ resolve(value: T): void; reject(cause: Error): void; timer: NodeJS.Timeout }> = []
  return {
    push(value: T) {
      const waiter = waiters.shift()
      if (waiter === undefined) queued.push(value)
      else {
        clearTimeout(waiter.timer)
        waiter.resolve(value)
      }
    },
    next(label: string): Promise<T> {
      const value = queued.shift()
      if (value !== undefined) return Promise.resolve(value)
      const { promise, resolve, reject } = Promise.withResolvers<T>()
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new Error(`${label} timed out`))
        }, 3_000),
      }
      waiters.push(waiter)
      return promise
    },
  }
}

function fileExporterPatch(
  destination: string,
  options: { readonly field?: 'path' | 'pathTemplate'; readonly level?: 'info' | 'debug' } = {},
): string {
  return [
    '- insert:',
    '    - id: runtime-logs-file',
    '      name: "@doppelganger/doppelganger-logging-file/loader"',
    '      inject: [doppelgangerLogging]',
    '      isolate:',
    '        doppelgangerLogging: session',
    '      config:',
    `        ${options.field ?? 'path'}: ${JSON.stringify(destination)}`,
    `        level: ${options.level ?? 'debug'}`,
    '        maxBytes: 65536',
    '        maxFiles: 2',
    '        maximumPendingRecords: 16',
    '',
  ].join('\n')
}

async function parsedJsonLines(path: string): Promise<RuntimeLogRecord[]> {
  const source = await readFile(path, 'utf8')
  return source.trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line) as RuntimeLogRecord)
}

async function testSession(sessionId = 'logging-session'): Promise<{
  readonly context: Context
  readonly router: RuntimeLoggingRouter
  readonly owner: Fiber
}> {
  const root = new Context()
  const plugin = root.plugin({ name: 'test-session-owner', apply: () => undefined })
  await plugin.await()
  const fibers = new WeakSet<Fiber>([plugin.ctx.fiber])
  plugin.ctx.on('internal/plugin', fiber => {
    if (fibers.has(fiber.parent.fiber)) fibers.add(fiber)
  }, { global: true })
  const context = plugin.ctx.isolate(RUNTIME_LOGGING_SERVICE)
  const router = new RuntimeLoggingRouter(context, createRuntimeSessionMetadata({
    sessionId,
    runtimePresetId: 'logging-test',
  }), fibers)
  plugin.ctx.effect(() => async () => { await router.dispose() }, 'testRuntimeLogging.dispose')
  return { context, router, owner: plugin.ctx.fiber }
}

async function emit(context: Context, name: string, severity: 'error' | 'warn' | 'info' | 'debug', ...args: unknown[]): Promise<void> {
  const fiber = context.plugin({
    name: `producer-${name}-${severity}`,
    apply(ctx) {
      const [format, ...parameters] = args
      ctx.logger(name)[severity](format, ...parameters)
    },
  })
  await fiber.await()
}

function collectingSink(records: RuntimeLogRecord[]): RuntimeLogSink {
  return { write(record) { records.push(record) } }
}

async function composition(entries: unknown[]): Promise<CompositionDefinition> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-runtime-logging-'))
  temporaryRoots.push(root)
  const loaderPath = join(root, 'runtime.cordis.json')
  await writeFile(loaderPath, JSON.stringify(entries))
  return createCompositionDefinition({ id: 'runtime-logging-test', revision: 'one', loaderPath })
}

async function fixture(root: string, name: string, source: string): Promise<string> {
  const filename = join(root, name)
  await writeFile(filename, source)
  return `./${name}`
}

describe('runtime logging contracts', () => {
  it('routes existing ctx.logger calls without a replacement logging facade', async () => {
    const session = await testSession()
    const records: RuntimeLogRecord[] = []
    session.router.register(collectingSink(records), { maximumPendingRecords: 16 })

    await emit(session.context, 'ordinary-plugin', 'info', 'hello %s', 'world')
    await waitFor(() => records.length === 1)

    expect(records[0]).toMatchObject({
      runtimeActivationId: session.router.scope.runtimeActivationId,
      sequence: 1,
      severity: 'info',
      logger: 'ordinary-plugin',
      message: 'hello world',
      sessionId: 'logging-session',
      runtimePresetId: 'logging-test',
    })
    expect(session.router.scope).toMatchObject({ sessionId: 'logging-session', runtimePresetId: 'logging-test' })
    expect(session.router.scope.runtimeActivationId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(Object.isFrozen(session.router.scope)).toBe(true)
    expect(Object.isFrozen(records[0])).toBe(true)
    await session.owner.dispose()
  })

  it('creates distinct activation identities when a logical session ID is reused', async () => {
    const first = await testSession('shared-logical-session')
    const second = await testSession('shared-logical-session')

    expect(first.router.scope.sessionId).toBe(second.router.scope.sessionId)
    expect(first.router.scope.runtimeActivationId).not.toBe(second.router.scope.runtimeActivationId)
    await Promise.all([first.owner.dispose(), second.owner.dispose()])
  })

  it('normalizes cyclic throwing and oversized Cordis logger arguments within bounds', async () => {
    const session = await testSession()
    const records: RuntimeLogRecord[] = []
    session.router.register(collectingSink(records), { maximumPendingRecords: 16 })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile') } })
    const error = new Error('x'.repeat(RUNTIME_LOGGING_LIMITS.maximumErrorMessageBytes + 100))

    await expect(emit(
      session.context,
      'x'.repeat(RUNTIME_LOGGING_LIMITS.maximumLoggerBytes + 100),
      'error',
      error,
      cyclic,
      hostile,
      Symbol('symbol'),
      () => undefined,
      'y'.repeat(RUNTIME_LOGGING_LIMITS.maximumMessageBytes + 100),
    )).resolves.toBeUndefined()
    await waitFor(() => records.length === 1)

    const record = records[0]!
    expect(Buffer.byteLength(record.logger, 'utf8')).toBeLessThanOrEqual(RUNTIME_LOGGING_LIMITS.maximumLoggerBytes)
    expect(Buffer.byteLength(record.message, 'utf8')).toBeLessThanOrEqual(RUNTIME_LOGGING_LIMITS.maximumMessageBytes)
    expect(Buffer.byteLength(record.error!.message, 'utf8')).toBeLessThanOrEqual(RUNTIME_LOGGING_LIMITS.maximumErrorMessageBytes)
    expect(JSON.stringify(record)).toContain('[circular]')
    expect(Object.isFrozen(record.error)).toBe(true)
    await session.owner.dispose()
  })

  it('replays the bounded activation buffer once to every initial sink', async () => {
    const session = await testSession()
    await emit(session.context, 'early', 'warn', 'before exporters')
    const first: RuntimeLogRecord[] = []
    const second: RuntimeLogRecord[] = []
    session.router.register(collectingSink(first), { maximumPendingRecords: 16 })
    session.router.register(collectingSink(second), { maximumPendingRecords: 16 })
    await emit(session.context, 'live', 'info', 'after exporters')
    session.router.settleActivation()
    await waitFor(() => first.length === 2 && second.length === 2)

    expect(first.map(record => record.message)).toEqual(['before exporters', 'after exporters'])
    expect(second.map(record => record.message)).toEqual(['before exporters', 'after exporters'])
    await session.owner.dispose()
  })

  it('drops the oldest activation records at the fixed buffer bound', async () => {
    const session = await testSession()
    for (let index = 0; index < RUNTIME_LOGGING_LIMITS.maximumActivationRecords + 3; index += 1) {
      await emit(session.context, 'overflow', 'info', 'record %d', index)
    }
    const records: RuntimeLogRecord[] = []
    session.router.register(collectingSink(records), {
      maximumPendingRecords: RUNTIME_LOGGING_LIMITS.maximumActivationRecords + 1,
    })
    await waitFor(() => records.length === RUNTIME_LOGGING_LIMITS.maximumActivationRecords + 1)

    expect(records[0]?.message).toContain('activation logging queue dropped 3 oldest records')
    expect(records[1]?.message).toBe('record 3')
    expect(records.at(-1)?.message).toBe(`record ${RUNTIME_LOGGING_LIMITS.maximumActivationRecords + 2}`)
    await session.owner.dispose()
  })

  it('releases early records after exporter-omitting activation settles', async () => {
    const session = await testSession()
    await emit(session.context, 'omitted', 'info', 'activation')
    session.router.settleActivation()
    await emit(session.context, 'omitted', 'info', 'after settlement')
    const records: RuntimeLogRecord[] = []
    session.router.register(collectingSink(records), { maximumPendingRecords: 4 })
    await emit(session.context, 'late', 'info', 'new record')
    await waitFor(() => records.length === 1)

    expect(records[0]?.message).toBe('new record')
    await session.owner.dispose()
  })

  it('delivers one record independently to multiple session sinks', async () => {
    const session = await testSession()
    session.router.settleActivation()
    const first: RuntimeLogRecord[] = []
    const second: RuntimeLogRecord[] = []
    session.router.register(collectingSink(first), { maximumPendingRecords: 4 })
    session.router.register(collectingSink(second), { maximumPendingRecords: 4 })

    await emit(session.context, 'multiple', 'warn', 'shared')
    await waitFor(() => first.length === 1 && second.length === 1)
    expect(first[0]).toEqual(second[0])
    await session.owner.dispose()
  })

  it('serializes asynchronous delivery and coalesces sink overflow', async () => {
    const session = await testSession()
    session.router.settleActivation()
    const records: RuntimeLogRecord[] = []
    let release: (() => void) | undefined
    const firstBlocked = new Promise<void>(resolve => { release = resolve })
    session.router.register({
      async write(record) {
        records.push(record)
        if (records.length === 1) await firstBlocked
      },
    }, { maximumPendingRecords: 2 })

    await emit(session.context, 'queue', 'info', 'one')
    await waitFor(() => records.length === 1)
    await emit(session.context, 'queue', 'info', 'two')
    await emit(session.context, 'queue', 'info', 'three')
    await emit(session.context, 'queue', 'info', 'four')
    release!()
    await waitFor(() => records.length === 4)

    expect(records.map(record => record.message)).toEqual([
      'one',
      'sink logging queue dropped 1 oldest record',
      'three',
      'four',
    ])
    await session.owner.dispose()
  })

  it('contains throwing and rejecting sinks without losing healthy siblings', async () => {
    const session = await testSession()
    session.router.settleActivation()
    const healthy: RuntimeLogRecord[] = []
    let failures = 0
    session.router.register({ write() { failures += 1; throw new Error('sink failed') } }, { maximumPendingRecords: 4 })
    session.router.register(collectingSink(healthy), { maximumPendingRecords: 4 })

    await expect(emit(session.context, 'failure', 'error', 'first')).resolves.toBeUndefined()
    await emit(session.context, 'failure', 'error', 'second')
    await waitFor(() => healthy.length === 2)

    expect(failures).toBe(1)
    expect(healthy.map(record => record.message)).toEqual(['first', 'second'])
    await session.owner.dispose()
  })

  it('isolates records and sinks across concurrent Runtime Sessions', async () => {
    const [firstSession, secondSession] = await Promise.all([testSession('first'), testSession('second')])
    firstSession.router.settleActivation()
    secondSession.router.settleActivation()
    const first: RuntimeLogRecord[] = []
    const second: RuntimeLogRecord[] = []
    firstSession.router.register(collectingSink(first), { maximumPendingRecords: 4 })
    secondSession.router.register(collectingSink(second), { maximumPendingRecords: 4 })

    await Promise.all([
      emit(firstSession.context, 'first-logger', 'info', 'first record'),
      emit(secondSession.context, 'second-logger', 'info', 'second record'),
    ])
    await waitFor(() => first.length === 1 && second.length === 1)

    expect(first[0]?.sessionId).toBe('first')
    expect(first[0]?.message).toBe('first record')
    expect(second[0]?.sessionId).toBe('second')
    expect(second[0]?.message).toBe('second record')
    await Promise.all([firstSession.owner.dispose(), secondSession.owner.dispose()])
  })

  it('applies severity and exact logger filters without exposing numeric levels', () => {
    expect(runtimeLogLevelAllows('debug', 'info', { verbose: 'debug' }, 'verbose')).toBe(true)
    expect(runtimeLogLevelAllows('debug', 'info', { verbose: 'debug' }, 'other')).toBe(false)
    expect(runtimeLogLevelAllows('warn', 'info')).toBe(true)
    expect(runtimeLogLevelAllows('info', 'warn')).toBe(false)
  })

  it('disposes registered sinks and the router idempotently', async () => {
    const session = await testSession()
    const records: RuntimeLogRecord[] = []
    const remove = session.router.register(collectingSink(records), { maximumPendingRecords: 4 })
    await Promise.all([remove(), remove()])
    await Promise.all([session.router.dispose(), session.router.dispose()])
    await expect(emit(session.context, 'disposed', 'info', 'ignored')).resolves.toBeUndefined()
    expect(records).toEqual([])
    await session.owner.dispose()
  })
})

describe('runtime logging integration', () => {
  it('captures activation logs before exporter rows settle', async () => {
    const definition = await composition([])
    const root = dirname(definition.loaderPath)
    const producer = await fixture(root, 'producer.mjs', [
      "export default { name: 'producer', apply(ctx) { ctx.logger('activation-producer').warn('activation warning') } }",
    ].join('\n'))
    const exporter = await fixture(root, 'exporter.mjs', [
      "export default { name: 'exporter', inject: ['doppelgangerLogging'], apply(ctx) {",
      '  globalThis.__runtimeLoggingRecords = []',
      '  ctx.doppelgangerLogging.register({ write(record) { globalThis.__runtimeLoggingRecords.push(record) } }, { maximumPendingRecords: 16 })',
      '} }',
    ].join('\n'))
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({
      sessionId: 'integrated',
      composition: createCompositionDefinition({
        ...definition,
        patches: [{
          source: 'logging integration',
          baseUrl: root,
          patches: [{ insert: [
            { id: 'producer', name: producer },
            {
              id: 'exporter',
              name: exporter,
              inject: ['doppelgangerLogging'],
              isolate: { doppelgangerLogging: 'session' },
            },
          ] }],
        }],
      }),
    })
    await waitFor(() => globalThis.__runtimeLoggingRecords?.some(record => record.logger === 'activation-producer') === true)

    expect(globalThis.__runtimeLoggingRecords?.find(record => record.logger === 'activation-producer')).toMatchObject({
      logger: 'activation-producer',
      message: 'activation warning',
      sessionId: 'integrated',
    })
    await session.dispose()
    await runtime.dispose()
  })

  it('keeps exporter-omitting sessions silent while plugins use ctx.logger', async () => {
    const definition = await composition([])
    const root = dirname(definition.loaderPath)
    const producer = await fixture(root, 'silent-producer.mjs', [
      "export default { name: 'silent-producer', apply(ctx) { ctx.logger('silent').info('not exported') } }",
    ].join('\n'))
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({
      sessionId: 'silent',
      composition: createCompositionDefinition({
        ...definition,
        patches: [{ source: 'silent fixture', baseUrl: root, patches: [{ insert: [{ id: 'producer', name: producer }] }] }],
      }),
    })

    expect(globalThis.__runtimeLoggingRecords).toBeUndefined()
    await session.dispose()
    await runtime.dispose()
  })

  it('activates a file exporter only through an explicit Runtime Patch', async () => {
    const definition = await composition([])
    const root = dirname(definition.loaderPath)
    const patchPath = join(root, 'runtime.cordis.patch.yml')
    const logTemplate = join(root, 'runtime-{runtimeActivationId}.jsonl')
    const reloads = eventQueue<void>()
    const failures = eventQueue<void>()
    let emit = () => undefined
    let runtimeActivationId = ''
    const runtime = createCompositionRuntime({
      watch: { base: root, root: [] },
      onReload: () => { reloads.push() },
      onReloadFailure: () => { failures.push() },
    })
    const session = await runtime.activate({
      sessionId: 'patch-opt-in',
      composition: createCompositionDefinition({
        ...definition,
        patches: [{ source: 'logging patch', filename: patchPath, optional: true }],
      }),
      protectedComposition: {
        entries: [
          { id: 'emitter', plugin: {
          name: 'runtime-logging-emitter',
          inject: ['doppelgangerLogging'],
          apply(ctx) {
            runtimeActivationId = ctx.doppelgangerLogging.scope.runtimeActivationId
            emit = () => { ctx.logger('patch-emitter').debug('debug record') }
          },
        } },
        ],
      },
    })
    const logPath = logTemplate.replace('{runtimeActivationId}', runtimeActivationId)

    emit()
    await expect(access(logPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const added = reloads.next('file exporter addition')
    await writeFile(patchPath, fileExporterPatch(logTemplate, { field: 'pathTemplate' }))
    await added
    emit()
    await waitFor(async () => (await parsedJsonLines(logPath).catch(() => []))
      .filter(record => record.logger === 'patch-emitter' && record.message === 'debug record').length === 1)

    const failed = failures.next('invalid file exporter reload')
    await writeFile(patchPath, fileExporterPatch('relative.jsonl'))
    await failed
    emit()
    await waitFor(async () => (await parsedJsonLines(logPath))
      .filter(record => record.logger === 'patch-emitter' && record.message === 'debug record').length === 2)
    const emitted = (await parsedJsonLines(logPath))
      .filter(record => record.logger === 'patch-emitter' && record.message === 'debug record')
    expect(new Set(emitted.map(record => record.runtimeActivationId))).toEqual(new Set([runtimeActivationId]))

    const removed = reloads.next('file exporter removal')
    await unlink(patchPath)
    await removed
    emit()
    await new Promise(resolve => setTimeout(resolve, 25))
    expect((await parsedJsonLines(logPath))
      .filter(record => record.logger === 'patch-emitter' && record.message === 'debug record')).toHaveLength(2)
    await session.dispose()
    await runtime.dispose()
  })

  it('rejects unknown and invalid exporter configuration through audited activation', async () => {
    const definition = await composition([])
    const root = dirname(definition.loaderPath)
    const logPath = join(root, 'invalid.jsonl')
    const runtime = createCompositionRuntime({ watch: false })
    const activation = runtime.activate({
      sessionId: 'invalid-exporter',
      composition: createCompositionDefinition({
        ...definition,
        patches: [{
          source: 'invalid logging exporter',
          baseUrl: root,
          patches: [{ insert: [{
            id: 'runtime-logs-file',
            name: '@doppelganger/doppelganger-logging-file/loader',
            inject: ['doppelgangerLogging'],
            isolate: { doppelgangerLogging: 'session' },
            config: { path: logPath, unknown: true },
          }] }],
        }],
      }),
    })

    await expect(activation).rejects.toThrow('unknown field')
    await expect(access(logPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await runtime.dispose()
  })

  it('cleans partially activated exporters and permits the same destination to reactivate', async () => {
    const definition = await composition([])
    const root = dirname(definition.loaderPath)
    const logPath = join(root, 'partial.jsonl')
    const waiting = await fixture(root, 'waiting.mjs', "export default { name: 'waiting', inject: ['absentService'], apply() {} }\n")
    const exporter = {
      id: 'runtime-logs-file',
      name: '@doppelganger/doppelganger-logging-file/loader',
      inject: ['doppelgangerLogging'],
      isolate: { doppelgangerLogging: 'session' },
      config: { path: logPath, level: 'info', maxBytes: 65_536, maxFiles: 1, maximumPendingRecords: 16 },
    }
    const runtime = createCompositionRuntime({ watch: false })
    await expect(runtime.activate({
      sessionId: 'partial-failure',
      composition: createCompositionDefinition({
        ...definition,
        patches: [{ source: 'partial fixture', baseUrl: root, patches: [{ insert: [exporter, { id: 'waiting', name: waiting }] }] }],
      }),
    })).rejects.toBeInstanceOf(CompositionActivationError)

    let emit = () => undefined
    const recovered = await runtime.activate({
      sessionId: 'partial-recovery',
      composition: createCompositionDefinition({
        ...definition,
        patches: [{ source: 'recovery fixture', baseUrl: root, patches: [{ insert: [exporter] }] }],
      }),
      protectedComposition: {
        entries: [
          { id: 'emitter', plugin: {
          name: 'partial-recovery-emitter',
          apply(ctx) { emit = () => { ctx.logger('recovered').info('recovered record') } },
        } },
        ],
      },
    })
    emit()
    await waitFor(async () => (await parsedJsonLines(logPath).catch(() => []))
      .some(record => record.logger === 'recovered' && record.message === 'recovered record'))
    await recovered.dispose()
    await runtime.dispose()
  })

  it('resolves one path template to isolated files for concurrent Runtime Sessions', async () => {
    const base = await composition([])
    const root = dirname(base.loaderPath)
    const runtime = createCompositionRuntime({ watch: false })
    const pathTemplate = join(root, 'runtime-{runtimeActivationId}.jsonl')
    const definition = createCompositionDefinition({
      ...base,
      patches: [{
        source: 'session file exporter',
        baseUrl: root,
        patches: [{ insert: [{
          id: 'runtime-logs-file',
          name: '@doppelganger/doppelganger-logging-file/loader',
          inject: ['doppelgangerLogging'],
          isolate: { doppelgangerLogging: 'session' },
          config: { pathTemplate, level: 'info', maxBytes: 65_536, maxFiles: 1, maximumPendingRecords: 16 },
        }] }],
      }],
    })
    let firstActivationId = ''
    let secondActivationId = ''
    let emitFirst = () => undefined
    let emitSecond = () => undefined
    const [first, second] = await Promise.all([
      runtime.activate({
        sessionId: 'shared-logical-session',
        composition: definition,
        protectedComposition: {
          entries: [
            { id: 'emitter', plugin: { name: 'first-emitter', inject: ['doppelgangerLogging'], apply(ctx) {
          firstActivationId = ctx.doppelgangerLogging.scope.runtimeActivationId
          emitFirst = () => { ctx.logger('first').info('first only') }
        } } },
          ],
        },
      }),
      runtime.activate({
        sessionId: 'shared-logical-session',
        composition: definition,
        protectedComposition: {
          entries: [
            { id: 'emitter', plugin: { name: 'second-emitter', inject: ['doppelgangerLogging'], apply(ctx) {
          secondActivationId = ctx.doppelgangerLogging.scope.runtimeActivationId
          emitSecond = () => { ctx.logger('second').info('second only') }
        } } },
          ],
        },
      }),
    ])
    const firstPath = pathTemplate.replace('{runtimeActivationId}', firstActivationId)
    const secondPath = pathTemplate.replace('{runtimeActivationId}', secondActivationId)
    expect(firstActivationId).not.toBe(secondActivationId)
    expect(firstPath).not.toBe(secondPath)
    emitFirst()
    emitSecond()
    await waitFor(async () => (
      (await parsedJsonLines(firstPath).catch(() => [])).some(record => record.message === 'first only')
      && (await parsedJsonLines(secondPath).catch(() => [])).some(record => record.message === 'second only')
    ))
    expect((await parsedJsonLines(firstPath)).find(record => record.message === 'first only')).toMatchObject({
      runtimeActivationId: firstActivationId,
      sessionId: 'shared-logical-session',
      message: 'first only',
    })
    expect((await parsedJsonLines(secondPath)).find(record => record.message === 'second only')).toMatchObject({
      runtimeActivationId: secondActivationId,
      sessionId: 'shared-logical-session',
      message: 'second only',
    })
    await Promise.all([first.dispose(), second.dispose()])
    await runtime.dispose()
  })

  it('exports core and protocol operational events without sensitive payloads', async () => {
    const definition = await composition([])
    const root = dirname(definition.loaderPath)
    const logPath = join(root, 'operations.jsonl')
    const exercise = await fixture(root, 'exercise.mjs', [
      "export default { name: 'first-party-exercise', inject: ['doppelgangerContext', 'doppelgangerTools'], async apply(ctx) {",
      "  ctx.doppelgangerContext.register({ id: 'probe.context', resolve: () => [{ source: 'probe', content: 'SENSITIVE_CONTEXT_MARKER', priority: 1, authority: 'data' }] })",
      "  ctx.doppelgangerTools.register({ name: 'probe.tool', description: 'probe', inputSchema: { type: 'object' }, invoke: () => ({ value: 'SENSITIVE_RESULT_MARKER' }) })",
      "  await ctx.doppelgangerContext.resolve({ turn: { input: 'SENSITIVE_INPUT_MARKER' }, tokenBudget: 100 })",
      "  const tool = ctx.doppelgangerTools.snapshot().tools.find(candidate => candidate.name === 'probe.tool')",
      "  await ctx.doppelgangerTools.invoke({ callId: 'probe-call', name: 'probe.tool', toolRevision: tool.revision, input: { value: 'SENSITIVE_TOOL_MARKER' } }, 'coverage-session')",
      "  await ctx.doppelgangerContext.resolve({ turn: { input: 'SENSITIVE_REJECTED_CONTEXT_MARKER' }, tokenBudget: -1 }).catch(() => undefined)",
      "  await ctx.doppelgangerTools.invoke({ callId: 'missing-call', name: 'missing.tool', toolRevision: 'missing:revision', input: { value: 'SENSITIVE_REJECTED_TOOL_MARKER' } }, 'coverage-session')",
      '} }',
    ].join('\n'))
    await writeFile(definition.loaderPath, JSON.stringify([
      {
        id: 'runtime-logs-file',
        name: '@doppelganger/doppelganger-logging-file/loader',
        inject: ['doppelgangerLogging'],
        isolate: { doppelgangerLogging: 'session' },
        config: { path: logPath, level: 'debug', maxBytes: 65_536, maxFiles: 1, maximumPendingRecords: 256 },
      },
      {
        id: 'context',
        name: '@doppelganger/doppelganger-protocols/context',
        isolate: { doppelgangerContext: 'session' },
      },
      {
        id: 'tools',
        name: '@doppelganger/doppelganger-protocols/tools',
        isolate: { doppelgangerTools: 'session' },
      },
      {
        id: 'exercise',
        name: exercise,
        inject: ['doppelgangerContext', 'doppelgangerTools'],
        isolate: { doppelgangerContext: 'session', doppelgangerTools: 'session' },
      },
    ]))
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({ sessionId: 'coverage-session', composition: definition })
    await waitFor(async () => {
      const records = await parsedJsonLines(logPath).catch(() => [])
      return records.some(record => record.message.startsWith('runtime.session.activation.completed'))
        && records.some(record => record.logger === 'doppelganger-context' && record.message.startsWith('context.resolve.completed'))
        && records.some(record => record.logger === 'doppelganger-context' && record.message.startsWith('context.resolve.rejected'))
        && records.some(record => record.logger === 'doppelganger-tools' && record.message.startsWith('tools.invoke.completed'))
        && records.some(record => record.logger === 'doppelganger-tools' && record.message.startsWith('tools.invoke.rejected'))
    })

    await session.dispose()
    await runtime.dispose()
    const source = await readFile(logPath, 'utf8')
    const records = source.trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line) as RuntimeLogRecord)
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ logger: 'doppelganger-composition-runtime', severity: 'info', message: 'runtime.session.activation.started' }),
      expect.objectContaining({ logger: 'doppelganger-context', severity: 'debug' }),
      expect.objectContaining({ logger: 'doppelganger-tools', severity: 'debug' }),
      expect.objectContaining({ logger: 'doppelganger-composition-runtime', severity: 'info', message: 'runtime.session.disposal.started' }),
    ]))
    expect(source).not.toContain('SENSITIVE_CONTEXT_MARKER')
    expect(source).not.toContain('SENSITIVE_INPUT_MARKER')
    expect(source).not.toContain('SENSITIVE_RESULT_MARKER')
    expect(source).not.toContain('SENSITIVE_TOOL_MARKER')
    expect(source).not.toContain('SENSITIVE_REJECTED_CONTEXT_MARKER')
    expect(source).not.toContain('SENSITIVE_REJECTED_TOOL_MARKER')
  })

  it('exports core and first-party component operational events without sensitive payloads', async () => {
    const definition = await composition([])
    const root = dirname(definition.loaderPath)
    const logPath = join(root, 'first-party-operations.jsonl')
    const storage = join(root, 'storage')
    const identity = join(root, 'identity.md')
    const trait = join(root, 'trait.md')
    await writeFile(identity, 'SENSITIVE_IDENTITY_MARKER')
    await writeFile(trait, 'SENSITIVE_TRAIT_MARKER')
    const actor = await fixture(root, 'actor.mjs', [
      `import { createActorIdentityPlugin } from ${JSON.stringify(protocolsModuleUrl)}`,
      "export default createActorIdentityPlugin('coverage-actor')",
    ].join('\n'))
    const runtimeHost = await fixture(root, 'runtime-host.mjs', [
      `import { createRuntimeHostPlugin } from ${JSON.stringify(protocolsModuleUrl)}`,
      "const binding = { attach() {}, detach() {}, toolCatalogChanged() {} }",
      "export default createRuntimeHostPlugin(binding, { protocolVersion: 2, context: { delivery: 'per-turn' }, tools: { delivery: 'dynamic', requiredApproval: true, cancellation: true }, lifecycle: { events: ['turn-committed'] } })",
    ].join('\n'))
    const lifecycleExercise = await fixture(root, 'lifecycle-exercise.mjs', [
      `import { publishLifecycleEvent, serializeLifecycleValue } from ${JSON.stringify(protocolsModuleUrl)}`,
      "export default { name: 'lifecycle-exercise', inject: ['doppelgangerContext', 'doppelgangerMemory', 'doppelgangerEvolution'], async apply(ctx) {",
      "  await ctx.doppelgangerContext.resolve({ turn: { input: 'SENSITIVE_CONTEXT_BODY_MARKER' }, tokenBudget: 128 })",
      "  await publishLifecycleEvent(ctx, { protocolVersion: 2, type: 'turn-committed', deliveryId: 'coverage-delivery', sessionId: 'first-party-coverage', turnId: 'coverage-turn', timestamp: 1, principalInput: serializeLifecycleValue('[fact:project.logging] SENSITIVE_LIFECYCLE_MARKER'), assistantOutput: serializeLifecycleValue('SENSITIVE_ASSISTANT_MARKER'), outcome: 'completed' })",
      '} }',
    ].join('\n'))
    await writeFile(definition.loaderPath, JSON.stringify([
      { id: 'logs', name: '@doppelganger/doppelganger-logging-file/loader', inject: ['doppelgangerLogging'], isolate: { doppelgangerLogging: 'session' }, config: { path: logPath, level: 'debug', maxBytes: 262_144, maxFiles: 1, maximumPendingRecords: 1_024 } },
      { id: 'context', name: contextModule, isolate: { doppelgangerContext: 'session' } },
      { id: 'tools', name: toolsModule, isolate: { doppelgangerTools: 'session' } },
      { id: 'actor', name: actor, isolate: { doppelgangerActor: 'session' } },
      { id: 'runtime-host', name: runtimeHost, isolate: { doppelgangerRuntimeSession: 'session', doppelgangerContext: 'session', doppelgangerTools: 'session', doppelgangerHostCapabilities: 'session' } },
      { id: 'persona', name: personaModule, inject: ['doppelgangerRuntimeSession', 'doppelgangerContext'], isolate: { doppelgangerRuntimeSession: 'session', doppelgangerContext: 'session', doppelgangerPersona: 'session' }, config: { instanceId: 'coverage-persona', identity: { path: identity }, traits: [{ name: 'coverage', path: trait }] } },
      { id: 'persona-authoring', name: personaAuthoringModule, inject: ['doppelgangerPersona', 'doppelgangerTools'], isolate: { doppelgangerPersona: 'session', doppelgangerTools: 'session' }, config: { writableTargets: ['trait:coverage'] } },
      { id: 'sqlite', name: sqliteModule, isolate: { doppelgangerInstanceSqlite: 'session' }, config: { home: storage } },
      { id: 'memory', name: memoryModule, inject: ['doppelgangerActor', 'doppelgangerPersona', 'doppelgangerContext', 'doppelgangerTools', 'doppelgangerInstanceSqlite'], isolate: { doppelgangerActor: 'session', doppelgangerPersona: 'session', doppelgangerContext: 'session', doppelgangerTools: 'session', doppelgangerInstanceSqlite: 'session', doppelgangerMemory: 'session', doppelgangerMemorySemantic: 'session' } },
      { id: 'memory-capture', name: memoryCaptureModule, inject: ['doppelgangerMemory', 'doppelgangerPersona', 'doppelgangerActor'], isolate: { doppelgangerMemory: 'session', doppelgangerPersona: 'session', doppelgangerActor: 'session', doppelgangerMemorySemantic: 'session' }, config: { enabled: true } },
      { id: 'inference', name: inferenceModule, isolate: { doppelgangerInference: 'session' }, config: { provider: 'coverage-provider', model: 'coverage-model', baseUrl: 'https://coverage.invalid/v1', modelContextWindow: 4_096 } },
      { id: 'evolution', name: evolutionModule, inject: ['doppelgangerRuntimeSession', 'doppelgangerActor', 'doppelgangerPersona', 'doppelgangerInstanceSqlite', 'doppelgangerContext', 'doppelgangerTools'], isolate: { doppelgangerRuntimeSession: 'session', doppelgangerActor: 'session', doppelgangerPersona: 'session', doppelgangerInstanceSqlite: 'session', doppelgangerContext: 'session', doppelgangerTools: 'session', doppelgangerEvolution: 'session' }, config: { proactiveSignalsEnabled: true, signalInferenceEnabled: false } },
      { id: 'dynamic', name: dynamicModule, inject: ['doppelgangerRuntimeSession', 'doppelgangerTools'], isolate: { doppelgangerRuntimeSession: 'session', doppelgangerTools: 'session' } },
      { id: 'codegraph', name: codegraphModule, inject: ['doppelgangerRuntimeSession', 'doppelgangerTools'], isolate: { doppelgangerRuntimeSession: 'session', doppelgangerTools: 'session' } },
      { id: 'mcp', name: mcpModule, inject: ['doppelgangerTools'], isolate: { doppelgangerTools: 'session', doppelgangerMcp: 'session' }, config: { servers: {} } },
      { id: 'embedding', name: embeddingModule, isolate: { doppelgangerMemoryEmbedder: 'session' } },
      { id: 'vector', name: sqliteVectorModule, isolate: { doppelgangerMemoryVectorIndex: 'session' }, config: { databasePath: join(storage, 'vectors.sqlite3'), namespace: 'coverage', dimensions: 384, sanitizedTarget: 'local:coverage' } },
      { id: 'semantic', name: vectorModule, inject: ['doppelgangerMemory', 'doppelgangerPersona', 'doppelgangerTools', 'doppelgangerMemoryEmbedder', 'doppelgangerMemoryVectorIndex'], isolate: { doppelgangerPersona: 'session', doppelgangerMemory: 'session', doppelgangerTools: 'session', doppelgangerMemoryEmbedder: 'session', doppelgangerMemoryVectorIndex: 'session', doppelgangerMemorySemantic: 'session' }, config: { instanceId: 'coverage-persona', pollIntervalMs: 10, batchSize: 4, retryBaseMs: 10, operationTimeoutMs: 1_000 } },
      { id: 'exercise', name: lifecycleExercise, inject: ['doppelgangerContext', 'doppelgangerMemory', 'doppelgangerEvolution'], isolate: { doppelgangerContext: 'session', doppelgangerMemory: 'session', doppelgangerEvolution: 'session' } },
    ]))
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({ sessionId: 'first-party-coverage', workspaceRoot: root, composition: definition })
    const expectedLoggers = [
      'doppelganger-actor-identity',
      'doppelganger-codegraph',
      'doppelganger-composition-runtime',
      'doppelganger-context',
      'doppelganger-dynamic-runtime-plugins',
      'doppelganger-embedding-local',
      'doppelganger-evolution',
      'doppelganger-evolution-signals',
      'doppelganger-inference-pi',
      'doppelganger-lifecycle',
      'doppelganger-mcp',
      'doppelganger-memory',
      'doppelganger-memory-capture',
      'doppelganger-memory-vector-coordinator',
      'doppelganger-memory-vectors-sqlite-exact',
      'doppelganger-persona',
      'doppelganger-persona-asset',
      'doppelganger-persona-authoring',
      'doppelganger-runtime-host',
      'doppelganger-sqlite',
      'doppelganger-tools',
    ]
    await waitFor(async () => {
      const observed = new Set((await parsedJsonLines(logPath).catch(() => [])).map(record => record.logger))
      return expectedLoggers.every(logger => observed.has(logger))
    }, 5_000)
    await session.dispose()
    await runtime.dispose()
    const source = await readFile(logPath, 'utf8')
    const observed = new Set(source.trimEnd().split('\n').filter(Boolean).map(line => (JSON.parse(line) as RuntimeLogRecord).logger))
    expect([...expectedLoggers].filter(logger => !observed.has(logger))).toEqual([])
    expect(source).not.toContain('SENSITIVE_IDENTITY_MARKER')
    expect(source).not.toContain('SENSITIVE_TRAIT_MARKER')
    expect(source).not.toContain('SENSITIVE_CONTEXT_BODY_MARKER')
    expect(source).not.toContain('SENSITIVE_LIFECYCLE_MARKER')
    expect(source).not.toContain('SENSITIVE_ASSISTANT_MARKER')
  })
})
