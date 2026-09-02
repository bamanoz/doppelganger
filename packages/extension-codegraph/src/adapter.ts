import type { JsonValue } from '@doppelganger/doppelganger-protocols'
import { CODEGRAPH_LIMITS, type NormalizedCodeGraphPluginConfig } from './config.ts'
import { CodeGraphError, boundedMessage } from './errors.ts'
import {
  CodeGraphProcessFailure,
  CodeGraphProcessRunner,
  resolveExecutable,
  type CodeGraphProcessResult,
} from './process.ts'
import { classifyCodeGraphSafety, parseCodeGraphStatus, statusResult } from './status.ts'
import {
  CODEGRAPH_SUPPORTED_VERSION_RANGE,
  type CodeGraphBinaryStatus,
  type CodeGraphExploreResult,
  type CodeGraphIndexStatus,
  type CodeGraphStatus,
} from './types.ts'

interface QueueWaiter {
  readonly resolve: () => void
  readonly reject: (cause: CodeGraphError) => void
}

function compatibleVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version)
  return match !== null && Number(match[1]) === 1 && Number(match[2]) === 6
}

function trimTerminalLineEnding(value: string): string {
  return value.endsWith('\r\n') ? value.slice(0, -2) : value.endsWith('\n') ? value.slice(0, -1) : value
}

function errorData(failure: CodeGraphProcessFailure): JsonValue | undefined {
  if (failure.stderr === undefined || failure.stderr.length === 0) return undefined
  return Object.freeze({ stderr: failure.stderr })
}

export class CodeGraphAdapter {
  readonly #workspaceRoot: string | undefined
  readonly #config: NormalizedCodeGraphPluginConfig
  readonly #runner: CodeGraphProcessRunner
  readonly #queue: QueueWaiter[] = []
  readonly #operations = new Set<Promise<unknown>>()
  #activeExplorations = 0
  #accepting = true
  #binary: CodeGraphBinaryStatus | undefined
  #discovery: Promise<CodeGraphBinaryStatus> | undefined
  #sync: Promise<void> | undefined
  #disposal: Promise<void> | undefined

  constructor(workspaceRoot: string | undefined, config: NormalizedCodeGraphPluginConfig) {
    this.#workspaceRoot = workspaceRoot
    this.#config = config
    this.#runner = new CodeGraphProcessRunner(config.shutdownTimeoutMs)
  }

  status(): Promise<CodeGraphStatus> {
    if (!this.#accepting) return Promise.reject(new CodeGraphError('CODEGRAPH_DISPOSED', 'CodeGraph integration is disposing'))
    return this.#track(this.#status())
  }

  explore(query: string, maxFiles: number): Promise<CodeGraphExploreResult> {
    if (!this.#accepting) return Promise.reject(new CodeGraphError('CODEGRAPH_DISPOSED', 'CodeGraph integration is disposing'))
    return this.#track(this.#explore(query, maxFiles))
  }

  async #status(): Promise<CodeGraphStatus> {
    if (this.#workspaceRoot === undefined) {
      return statusResult(undefined, Object.freeze({
        available: false,
        executable: this.#config.executable,
        compatible: false,
      }))
    }
    const binary = await this.#discover(false)
    if (!binary.available || !binary.compatible) return statusResult(this.#workspaceRoot, binary)
    const index = await this.#readStatus(binary)
    return statusResult(this.#workspaceRoot, binary, index)
  }

  async #explore(query: string, maxFiles: number): Promise<CodeGraphExploreResult> {
    if (this.#workspaceRoot === undefined) {
      throw new CodeGraphError('CODEGRAPH_WORKSPACE_REQUIRED', 'CodeGraph exploration requires a Runtime Session workspace root')
    }
    if (!this.#accepting) throw new CodeGraphError('CODEGRAPH_DISPOSED', 'CodeGraph integration is disposing')
    await this.#acquireExploration()
    try {
      const binary = await this.#discover(true)
      let index = await this.#readStatus(binary)
      let safety = classifyCodeGraphSafety(this.#workspaceRoot, binary, index)
      if (safety.repairable) {
        await this.#synchronize(binary)
        index = await this.#readStatus(binary)
        safety = classifyCodeGraphSafety(this.#workspaceRoot, binary, index)
      }
      if (!safety.safe) throw this.#unsafeIndex(index, safety.diagnostic)
      const result = await this.#run({
        executable: binary.executable,
        args: ['explore', '--path', this.#workspaceRoot, '--max-files', String(maxFiles), '--', query],
        timeoutMs: this.#config.exploreTimeoutMs,
        maximumStdoutBytes: this.#config.maximumExploreOutputBytes,
        failureCode: 'CODEGRAPH_QUERY_FAILED',
        operation: 'exploration',
      })
      const content = trimTerminalLineEnding(result.stdout)
      if (content.length === 0) throw new CodeGraphError('CODEGRAPH_QUERY_FAILED', 'CodeGraph exploration returned empty output')
      return Object.freeze({ workspaceRoot: this.#workspaceRoot, maxFiles, content })
    } finally {
      this.#releaseExploration()
    }
  }

  async #discover(required: boolean): Promise<CodeGraphBinaryStatus> {
    if (this.#binary !== undefined) return this.#binary
    this.#discovery ??= (async () => {
      try {
        const executable = await resolveExecutable(this.#config.executable)
        const result = await this.#runner.run({
          executable,
          args: ['--version'],
          cwd: this.#workspaceRoot ?? process.cwd(),
          timeoutMs: this.#config.statusTimeoutMs,
          maximumStdoutBytes: 4_096,
          maximumStderrBytes: CODEGRAPH_LIMITS.stderrBytes,
        })
        const version = result.stdout.trim()
        if (version.length === 0 || Buffer.byteLength(version, 'utf8') > 128) {
          throw new CodeGraphError('CODEGRAPH_BINARY_INCOMPATIBLE', 'CodeGraph returned an invalid version')
        }
        const status = Object.freeze({
          available: true,
          executable,
          version,
          compatible: compatibleVersion(version),
        })
        if (!status.compatible && required) {
          throw new CodeGraphError(
            'CODEGRAPH_BINARY_INCOMPATIBLE',
            `CodeGraph ${version} is unsupported; expected ${CODEGRAPH_SUPPORTED_VERSION_RANGE}`,
          )
        }
        if (status.compatible) this.#binary = status
        return status
      } catch (cause) {
        if (cause instanceof CodeGraphError) throw cause
        if (required) throw this.#processError(cause, 'CODEGRAPH_BINARY_UNAVAILABLE', 'binary discovery')
        return Object.freeze({
          available: false,
          executable: this.#config.executable,
          compatible: false,
        })
      }
    })()
    try {
      return await this.#discovery
    } finally {
      if (this.#binary === undefined) this.#discovery = undefined
    }
  }

  async #readStatus(binary: CodeGraphBinaryStatus): Promise<CodeGraphIndexStatus> {
    if (this.#workspaceRoot === undefined) {
      throw new CodeGraphError('CODEGRAPH_WORKSPACE_REQUIRED', 'CodeGraph status requires a Runtime Session workspace root')
    }
    const result = await this.#run({
      executable: binary.executable,
      args: ['status', this.#workspaceRoot, '--json'],
      timeoutMs: this.#config.statusTimeoutMs,
      maximumStdoutBytes: CODEGRAPH_LIMITS.statusOutputBytes,
      failureCode: 'CODEGRAPH_STATUS_INVALID',
      operation: 'status',
    })
    return parseCodeGraphStatus(result.stdout)
  }

  async #synchronize(binary: CodeGraphBinaryStatus): Promise<void> {
    if (this.#workspaceRoot === undefined) throw new CodeGraphError('CODEGRAPH_WORKSPACE_REQUIRED', 'CodeGraph sync requires a workspace')
    this.#sync ??= this.#run({
      executable: binary.executable,
      args: ['sync', this.#workspaceRoot, '--quiet'],
      timeoutMs: this.#config.syncTimeoutMs,
      maximumStdoutBytes: CODEGRAPH_LIMITS.statusOutputBytes,
      failureCode: 'CODEGRAPH_SYNC_FAILED',
      operation: 'incremental sync',
    }).then(() => undefined).finally(() => { this.#sync = undefined })
    await this.#sync
  }

  async #run(input: {
    readonly executable: string
    readonly args: readonly string[]
    readonly timeoutMs: number
    readonly maximumStdoutBytes: number
    readonly failureCode: 'CODEGRAPH_STATUS_INVALID' | 'CODEGRAPH_SYNC_FAILED' | 'CODEGRAPH_QUERY_FAILED'
    readonly operation: string
  }): Promise<CodeGraphProcessResult> {
    if (this.#workspaceRoot === undefined) throw new CodeGraphError('CODEGRAPH_WORKSPACE_REQUIRED', 'CodeGraph command requires a workspace')
    try {
      return await this.#runner.run({
        executable: input.executable,
        args: input.args,
        cwd: this.#workspaceRoot,
        timeoutMs: input.timeoutMs,
        maximumStdoutBytes: input.maximumStdoutBytes,
        maximumStderrBytes: CODEGRAPH_LIMITS.stderrBytes,
      })
    } catch (cause) {
      throw this.#processError(cause, input.failureCode, input.operation)
    }
  }

  #processError(
    cause: unknown,
    fallback: 'CODEGRAPH_BINARY_UNAVAILABLE' | 'CODEGRAPH_STATUS_INVALID' | 'CODEGRAPH_SYNC_FAILED' | 'CODEGRAPH_QUERY_FAILED',
    operation: string,
  ): CodeGraphError {
    if (cause instanceof CodeGraphError) return cause
    if (!(cause instanceof CodeGraphProcessFailure)) return new CodeGraphError(fallback, `${operation} failed: ${boundedMessage(cause)}`)
    const code = cause.kind === 'timeout'
      ? 'CODEGRAPH_TIMEOUT'
      : cause.kind === 'output-limit'
        ? 'CODEGRAPH_OUTPUT_LIMIT'
        : cause.kind === 'disposed'
          ? 'CODEGRAPH_DISPOSED'
          : fallback
    return new CodeGraphError(code, `${operation} failed: ${cause.message}`, errorData(cause))
  }

  #unsafeIndex(index: CodeGraphIndexStatus, diagnostic: string | undefined): CodeGraphError {
    if (!index.initialized) {
      return new CodeGraphError('CODEGRAPH_INDEX_UNINITIALIZED', 'CodeGraph is not initialized for this workspace; the user must run codegraph init')
    }
    return new CodeGraphError('CODEGRAPH_INDEX_UNSAFE', diagnostic ?? 'CodeGraph index is not safe for exploration')
  }

  async #acquireExploration(): Promise<void> {
    if (!this.#accepting) throw new CodeGraphError('CODEGRAPH_DISPOSED', 'CodeGraph integration is disposing')
    if (this.#activeExplorations < this.#config.maximumConcurrentExplorations) {
      this.#activeExplorations += 1
      return
    }
    if (this.#queue.length >= this.#config.maximumQueuedExplorations) {
      throw new CodeGraphError('CODEGRAPH_QUERY_FAILED', 'CodeGraph exploration queue is full')
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    this.#queue.push({ resolve, reject })
    await promise
  }

  #releaseExploration(): void {
    if (this.#activeExplorations > 0) this.#activeExplorations -= 1
    if (!this.#accepting) return
    const waiter = this.#queue.shift()
    if (waiter === undefined) return
    this.#activeExplorations += 1
    waiter.resolve()
  }

  #track<T>(operation: Promise<T>): Promise<T> {
    this.#operations.add(operation)
    void operation.finally(() => { this.#operations.delete(operation) }).catch(() => undefined)
    return operation
  }

  dispose(): Promise<void> {
    if (this.#disposal !== undefined) return this.#disposal
    this.#accepting = false
    const failure = new CodeGraphError('CODEGRAPH_DISPOSED', 'CodeGraph integration is disposing')
    for (const waiter of this.#queue.splice(0)) waiter.reject(failure)
    this.#disposal = (async () => {
      await this.#runner.dispose()
      await Promise.allSettled([...this.#operations])
    })()
    return this.#disposal
  }
}
