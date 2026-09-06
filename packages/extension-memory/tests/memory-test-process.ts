import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type {
  CorrectMemoryRequest,
  ForgetMemoryRequest,
  MemoryRecord,
  RememberMemoryRequest,
} from '../src/index.ts'

export type MemoryTestClientRequest = {
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

export type MemoryTestClientResult =
  | { readonly ok: true; readonly value: MemoryRecord | boolean }
  | { readonly ok: false; readonly error: { readonly name: string; readonly code?: string } }

interface ChildMessage {
  readonly type: 'ready' | 'result' | 'fatal'
  readonly ok?: boolean
  readonly value?: MemoryRecord | boolean
  readonly error?: { readonly name: string; readonly code?: string } | string
}

export interface MemoryTestClientProcess {
  go(): Promise<MemoryTestClientResult>
  close(): Promise<void>
}

const clientPath = fileURLToPath(new URL('./memory-test-client.ts', import.meta.url))

export async function startMemoryTestClient(
  request: MemoryTestClientRequest,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<MemoryTestClientProcess> {
  const child = spawn(process.execPath, [clientPath], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...environment,
      DOPPELGANGER_MEMORY_TEST_CLIENT_REQUEST: JSON.stringify(request),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const messages: ChildMessage[] = []
  const waiters: Array<(message: ChildMessage) => void> = []
  let buffered = ''
  let stderr = ''
  let exited = false
  let exitFailure: Error | undefined
  const processExit = Promise.withResolvers<never>()

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffered += chunk
    while (true) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) break
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (line.length === 0) continue
      const message = JSON.parse(line) as ChildMessage
      const waiter = waiters.shift()
      if (waiter === undefined) messages.push(message)
      else waiter(message)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })
  child.once('error', error => {
    exitFailure = error
    processExit.reject(error)
  })
  child.once('exit', code => {
    exited = true
    if (code !== 0 && exitFailure === undefined) {
      exitFailure = new Error(`memory test client exited with code ${code ?? 'signal'}${stderr.length === 0 ? '' : ' and stderr output'}`)
    }
    processExit.reject(exitFailure ?? new Error('memory test client exited before responding'))
  })

  const nextMessage = async (): Promise<ChildMessage> => {
    const queued = messages.shift()
    if (queued !== undefined) return queued
    if (exited) throw exitFailure ?? new Error('memory test client exited before responding')
    const message = Promise.withResolvers<ChildMessage>()
    waiters.push(message.resolve)
    return Promise.race([message.promise, processExit.promise])
  }

  const ready = await nextMessage()
  if (ready.type !== 'ready') {
    await closeChild(child)
    throw new Error('memory test client failed before readiness')
  }

  let resultPromise: Promise<MemoryTestClientResult> | undefined
  return {
    go() {
      resultPromise ??= (async () => {
        child.stdin.end('go\n')
        const message = await nextMessage()
        if (message.type !== 'result' || typeof message.ok !== 'boolean') {
          throw new Error('memory test client returned an invalid result')
        }
        if (message.ok) return { ok: true, value: message.value! }
        if (typeof message.error !== 'object' || message.error === null) {
          throw new Error('memory test client returned an invalid failure')
        }
        return { ok: false, error: message.error }
      })()
      return resultPromise
    },
    close() {
      return closeChild(child)
    },
  }
}

async function closeChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.stdin.end()
  child.kill('SIGTERM')
  const exited = Promise.withResolvers<void>()
  child.once('exit', () => exited.resolve())
  await exited.promise
}
