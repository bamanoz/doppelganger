import type { Readable, Writable } from 'node:stream'

export type RpcId = number | string

export interface RpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: RpcId
  readonly method: string
  readonly params?: unknown
}

export interface RpcNotification {
  readonly jsonrpc: '2.0'
  readonly method: string
  readonly params?: unknown
}

export interface RpcSuccess {
  readonly jsonrpc: '2.0'
  readonly id: RpcId
  readonly result: unknown
}

export interface RpcFailure {
  readonly jsonrpc: '2.0'
  readonly id: RpcId | null
  readonly error: {
    readonly code: number
    readonly message: string
    readonly data?: unknown
  }
}

export type RpcMessage = RpcRequest | RpcNotification | RpcSuccess | RpcFailure
export type RpcHandler = (params: unknown) => unknown | Promise<unknown>

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n')
const MAX_CONTENT_LENGTH = 16 * 1024 * 1024

export class RpcProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RpcProtocolError'
  }
}

export class RpcRemoteError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcRemoteError'
    this.code = code
    this.data = data
  }
}

export function encodeRpcMessage(message: RpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body])
}

export class ContentLengthDecoder {
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  #expectedLength: number | undefined

  push(chunk: Buffer): RpcMessage[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk])
    const messages: RpcMessage[] = []
    while (true) {
      if (this.#expectedLength === undefined) {
        const headerEnd = this.#buffer.indexOf(HEADER_SEPARATOR)
        if (headerEnd < 0) return messages
        const header = this.#buffer.subarray(0, headerEnd).toString('ascii')
        const lengths = header.split('\r\n').flatMap(line => {
          const match = /^Content-Length:\s*(\d+)\s*$/i.exec(line)
          return match === null ? [] : [Number(match[1])]
        })
        if (lengths.length !== 1 || !Number.isSafeInteger(lengths[0]) || lengths[0]! > MAX_CONTENT_LENGTH) {
          throw new RpcProtocolError('invalid or missing Content-Length header')
        }
        this.#expectedLength = lengths[0]
        this.#buffer = this.#buffer.subarray(headerEnd + HEADER_SEPARATOR.length)
      }
      const expectedLength = this.#expectedLength
      if (expectedLength === undefined) throw new RpcProtocolError('missing decoded content length')
      if (this.#buffer.length < expectedLength) return messages
      const body = this.#buffer.subarray(0, expectedLength)
      this.#buffer = this.#buffer.subarray(expectedLength)
      this.#expectedLength = undefined
      let value: unknown
      try {
        value = JSON.parse(body.toString('utf8'))
      } catch (cause) {
        throw new RpcProtocolError(`invalid JSON-RPC body: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
      if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new RpcProtocolError('JSON-RPC message must be an object')
      }
      messages.push(value as RpcMessage)
    }
  }
}

interface PendingRequest {
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
}

export class FramedJsonRpcPeer {
  readonly #reader: Readable
  readonly #writer: Writable
  readonly #decoder = new ContentLengthDecoder()
  readonly #handlers = new Map<string, RpcHandler>()
  readonly #notificationHandlers = new Map<string, Set<RpcHandler>>()
  readonly #pending = new Map<RpcId, PendingRequest>()
  #nextId = 1
  #closed = false

  constructor(reader: Readable, writer: Writable) {
    this.#reader = reader
    this.#writer = writer
    reader.on('data', this.#onData)
    reader.on('end', this.#onEnd)
    reader.on('error', this.#onError)
    writer.on('error', this.#onError)
  }

  expose(method: string, handler: RpcHandler): () => void {
    if (this.#handlers.has(method)) throw new Error(`RPC method "${method}" is already exposed`)
    this.#handlers.set(method, handler)
    return () => this.#handlers.delete(method)
  }

  onNotification(method: string, handler: RpcHandler): () => void {
    const handlers = this.#notificationHandlers.get(method) ?? new Set<RpcHandler>()
    handlers.add(handler)
    this.#notificationHandlers.set(method, handlers)
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.#notificationHandlers.delete(method)
    }
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.#closed) return Promise.reject(new RpcProtocolError('JSON-RPC peer is closed'))
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.#closed) throw new RpcProtocolError('JSON-RPC peer is closed')
    this.#send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
  }
  close(reason = 'JSON-RPC peer closed'): void {
    if (this.#closed) return
    this.#closed = true
    this.#detach()
    this.#rejectPending(new RpcProtocolError(reason))
    this.#writer.end()
  }

  #send(message: RpcMessage): void {
    this.#writer.write(encodeRpcMessage(message))
  }

  readonly #onData = (chunk: Buffer) => {
    try {
      for (const message of this.#decoder.push(Buffer.from(chunk))) {
        void this.#dispatch(message).catch(cause => {
          this.#fail(cause instanceof Error ? cause : new RpcProtocolError(String(cause)))
        })
      }
    } catch (cause) {
      this.#fail(cause instanceof Error ? cause : new RpcProtocolError(String(cause)))
    }
  }

  readonly #onEnd = () => this.#fail(new RpcProtocolError('JSON-RPC stream ended'))
  readonly #onError = (cause: Error) => this.#fail(cause)

  async #dispatch(message: RpcMessage): Promise<void> {
    if ('method' in message) {
      if ('id' in message) await this.#dispatchRequest(message)
      else {
        const handlers = this.#notificationHandlers.get(message.method)
        if (handlers !== undefined) await Promise.all([...handlers].map(handler => handler(message.params)))
      }
      return
    }
    const pending = this.#pending.get(message.id as RpcId)
    if (pending === undefined) return
    this.#pending.delete(message.id as RpcId)
    if ('error' in message) pending.reject(new RpcRemoteError(message.error.code, message.error.message, message.error.data))
    else pending.resolve(message.result)
  }

  async #dispatchRequest(message: RpcRequest): Promise<void> {
    const handler = this.#handlers.get(message.method)
    if (handler === undefined) {
      this.#send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } })
      return
    }
    try {
      const result = await handler(message.params)
      this.#send({ jsonrpc: '2.0', id: message.id, result: result ?? null })
    } catch (cause) {
      this.#send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: cause instanceof Error ? cause.message : String(cause),
        },
      })
    }
  }

  #fail(cause: Error): void {
    if (this.#closed) return
    this.#closed = true
    this.#detach()
    this.#rejectPending(cause)
  }

  #rejectPending(cause: Error): void {
    for (const pending of this.#pending.values()) pending.reject(cause)
    this.#pending.clear()
  }

  #detach(): void {
    this.#reader.off('data', this.#onData)
    this.#reader.off('end', this.#onEnd)
    this.#reader.off('error', this.#onError)
    this.#writer.off('error', this.#onError)
  }
}
