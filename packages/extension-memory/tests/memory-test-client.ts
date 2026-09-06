import { createInterface } from 'node:readline'
import { Context } from '@deepseek-ai/cordis'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import {
  MemoryService,
  PostgresqlMemoryPlugin,
  SqliteMemoryPlugin,
  type CorrectMemoryRequest,
  type ForgetMemoryRequest,
  type RememberMemoryRequest,
} from '../src/index.ts'

interface ClientRequest {
  readonly backend:
    | { readonly kind: 'sqlite'; readonly home: string; readonly namespace: string }
    | { readonly kind: 'postgresql'; readonly connectionStringEnv: string; readonly schema: string }
  readonly actorId: string
  readonly sessionId: string
  readonly projectId: string
  readonly operation:
    | { readonly kind: 'remember'; readonly request: RememberMemoryRequest }
    | { readonly kind: 'correct'; readonly request: CorrectMemoryRequest }
    | { readonly kind: 'forget'; readonly request: ForgetMemoryRequest }
    | { readonly kind: 'inspect'; readonly id: string }
}

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

async function main(): Promise<void> {
  const source = process.env.DOPPELGANGER_MEMORY_TEST_CLIENT_REQUEST
  if (source === undefined) throw new Error('missing memory test client request')
  const request = JSON.parse(source) as ClientRequest
  const context = new Context()
  try {
    await context.plugin(createPersonaActivationPlugin({
      instanceId: 'backend-persona',
      sessionId: request.sessionId,
      projectId: request.projectId,
      projectRoot: request.backend.kind === 'sqlite' ? request.backend.home : process.cwd(),
    })).await()
    await context.plugin(createActorIdentityPlugin(request.actorId)).await()
    if (request.backend.kind === 'sqlite') {
      await context.plugin(SqliteMemoryPlugin, {
        home: request.backend.home,
        namespace: request.backend.namespace,
        busyTimeoutMs: 30_000,
      }).await()
    } else {
      await context.plugin(PostgresqlMemoryPlugin, {
        connectionStringEnv: request.backend.connectionStringEnv,
        schema: request.backend.schema,
        poolSize: 1,
        connectionTimeoutMs: 5_000,
        statementTimeoutMs: 30_000,
        lockTimeoutMs: 30_000,
      }).await()
    }
    await context.plugin(MemoryService).await()
    send({ type: 'ready' })
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
    for await (const line of input) {
      if (line !== 'go') continue
      try {
        const operation = request.operation
        const value = operation.kind === 'remember'
          ? await context.doppelgangerMemory.remember(operation.request)
          : operation.kind === 'correct'
            ? await context.doppelgangerMemory.correct(operation.request)
            : operation.kind === 'forget'
              ? await context.doppelgangerMemory.forget(operation.request)
              : await context.doppelgangerMemory.inspect(operation.id)
        send({ type: 'result', ok: true, value })
      } catch (error) {
        send({
          type: 'result',
          ok: false,
          error: {
            name: error instanceof Error ? error.name : typeof error,
            code: typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
          },
        })
      }
      break
    }
  } finally {
    await context.fiber.dispose()
  }
}

await main().catch(error => {
  send({ type: 'fatal', error: error instanceof Error ? error.name : typeof error })
  process.exitCode = 1
})
