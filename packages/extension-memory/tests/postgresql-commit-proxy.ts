import { createServer, connect, type Server, type Socket } from 'node:net'

export interface PostgresqlCommitDropProxy {
  readonly connectionString: string
  arm(): void
  committedResponseDropped(): Promise<void>
  close(): Promise<void>
}

function frames(buffer: Buffer, typed: boolean): { readonly complete: Buffer[]; readonly remainder: Buffer } {
  const complete: Buffer[] = []
  let offset = 0
  while (true) {
    const prefix = typed ? 5 : 4
    if (buffer.length - offset < prefix) break
    const length = buffer.readInt32BE(offset + (typed ? 1 : 0))
    const total = typed ? length + 1 : length
    if (length < 4 || buffer.length - offset < total) break
    complete.push(buffer.subarray(offset, offset + total))
    offset += total
    if (!typed) typed = true
  }
  return { complete, remainder: buffer.subarray(offset) }
}

function frameText(frame: Buffer): string {
  return frame.subarray(5).toString('utf8').replaceAll('\0', ' ').trim().toUpperCase()
}

export async function createPostgresqlCommitDropProxy(targetConnectionString: string): Promise<PostgresqlCommitDropProxy> {
  const target = new URL(targetConnectionString)
  const targetPort = Number(target.port || 5432)
  let armed = false
  let commitSent = false
  let closed = false
  const sockets = new Set<Socket>()
  const dropped = Promise.withResolvers<void>()
  const listening = Promise.withResolvers<void>()

  const server: Server = createServer(client => {
    const upstream = connect({ host: target.hostname, port: targetPort })
    sockets.add(client)
    sockets.add(upstream)
    let clientBuffer = Buffer.alloc(0)
    let serverBuffer = Buffer.alloc(0)
    let startupComplete = false

    const forget = () => {
      sockets.delete(client)
      sockets.delete(upstream)
    }
    client.once('close', forget)
    upstream.once('close', forget)
    client.on('error', () => undefined)
    upstream.on('error', () => client.destroy())

    client.on('data', chunk => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      clientBuffer = Buffer.concat([clientBuffer, bytes])
      const parsed = frames(clientBuffer, startupComplete)
      clientBuffer = Buffer.from(parsed.remainder)
      for (const frame of parsed.complete) {
        if (!startupComplete) startupComplete = true
        else if (armed && ['Q', 'P'].includes(String.fromCharCode(frame[0]!)) && /(?:^|\s)COMMIT(?:\s|$)/u.test(frameText(frame))) {
          commitSent = true
        }
        upstream.write(frame)
      }
    })

    upstream.on('data', chunk => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      serverBuffer = Buffer.concat([serverBuffer, bytes])
      const parsed = frames(serverBuffer, true)
      serverBuffer = Buffer.from(parsed.remainder)
      for (const frame of parsed.complete) {
        const type = String.fromCharCode(frame[0]!)
        if (armed && commitSent && type === 'C' && frameText(frame) === 'COMMIT') {
          armed = false
          commitSent = false
          client.destroy()
          upstream.destroy()
          dropped.resolve()
          return
        }
        client.write(frame)
      }
    })
  })
  server.once('error', error => listening.reject(error))
  server.listen(0, '127.0.0.1', () => listening.resolve())
  await listening.promise
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('PostgreSQL commit proxy did not bind a TCP port')
  const proxyUrl = new URL(target.toString())
  proxyUrl.hostname = '127.0.0.1'
  proxyUrl.port = String(address.port)
  proxyUrl.searchParams.set('sslmode', 'disable')

  return {
    connectionString: proxyUrl.toString(),
    arm() {
      if (closed) throw new Error('PostgreSQL commit proxy is closed')
      armed = true
      commitSent = false
    },
    committedResponseDropped() {
      return dropped.promise
    },
    async close() {
      if (closed) return
      closed = true
      for (const socket of sockets) socket.destroy()
      const settled = Promise.withResolvers<void>()
      server.close(() => settled.resolve())
      await settled.promise
    },
  }
}
