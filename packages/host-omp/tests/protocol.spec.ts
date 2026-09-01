import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  ContentLengthDecoder,
  FramedJsonRpcPeer,
  RpcProtocolError,
  encodeRpcMessage,
  type FramedJsonRpcPeerOptions,
} from '../src/protocol.ts'

function connectedPeers(rightOptions: FramedJsonRpcPeerOptions = {}) {
  const leftToRight = new PassThrough()
  const rightToLeft = new PassThrough()
  return {
    left: new FramedJsonRpcPeer(rightToLeft, leftToRight),
    right: new FramedJsonRpcPeer(leftToRight, rightToLeft, rightOptions),
  }
}

describe('Content-Length JSON-RPC transport', () => {
  it('decodes fragmented and coalesced frames containing arbitrary newlines', () => {
    const first = encodeRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'echo',
      params: { text: 'line one\nline two' },
    })
    const second = encodeRpcMessage({ jsonrpc: '2.0', method: 'changed' })
    const wire = Buffer.concat([first, second])
    const decoder = new ContentLengthDecoder()
    expect(decoder.push(wire.subarray(0, 7))).toEqual([])
    expect(decoder.push(wire.subarray(7, first.length + 5))).toEqual([
      expect.objectContaining({ id: 1, params: { text: 'line one\nline two' } }),
    ])
    expect(decoder.push(wire.subarray(first.length + 5))).toEqual([
      { jsonrpc: '2.0', method: 'changed' },
    ])
  })

  it('fails malformed frames locally', () => {
    const decoder = new ContentLengthDecoder()
    expect(() => decoder.push(Buffer.from('Other: 2\r\n\r\n{}'))).toThrow(RpcProtocolError)
    expect(() => new ContentLengthDecoder().push(Buffer.from('Content-Length: 1\r\n\r\n{')))
      .toThrow(/invalid JSON-RPC body/)
  })

  it('round-trips requests and notifications while keeping remote errors structured', async () => {
    const { left, right } = connectedPeers()
    right.expose('sum', params => {
      const values = params as { left: number; right: number }
      return values.left + values.right
    })
    right.expose('explode', () => {
      throw new Error('remote exploded')
    })
    const notifications: unknown[] = []
    right.onNotification('observe', params => notifications.push(params))

    await expect(left.request('sum', { left: 2, right: 3 })).resolves.toBe(5)
    left.notify('observe', { event: 'turn.started' })
    await new Promise(resolve => setImmediate(resolve))
    expect(notifications).toEqual([{ event: 'turn.started' }])
    await expect(left.request('explode')).rejects.toMatchObject({
      code: -32603,
      message: 'remote exploded',
    })
    await expect(left.request('sum', { left: 7, right: 4 })).resolves.toBe(11)

    left.close()
    right.close()
  })

  it('contains rejecting notification observers and preserves later traffic', async () => {
    const diagnostics: unknown[] = []
    const { left, right } = connectedPeers({
      onNotificationObserverError(diagnostic) {
        diagnostics.push(diagnostic)
        throw new Error('diagnostic sink failed')
      },
    })
    right.expose('sum', params => {
      const values = params as { left: number; right: number }
      return values.left + values.right
    })
    const observed: unknown[] = []
    right.onNotification('observe', () => { throw new Error('observer failed with sensitive detail') })
    right.onNotification('observe', params => { observed.push(params) })

    left.notify('observe', { cycle: 1 })
    await new Promise(resolve => setImmediate(resolve))
    expect(observed).toEqual([{ cycle: 1 }])
    expect(diagnostics).toEqual([{
      method: 'observe',
      message: 'observer failed with sensitive detail',
    }])
    await expect(left.request('sum', { left: 4, right: 5 })).resolves.toBe(9)
    left.notify('observe', { cycle: 2 })
    await new Promise(resolve => setImmediate(resolve))
    expect(observed).toEqual([{ cycle: 1 }, { cycle: 2 }])
    expect(diagnostics).toHaveLength(2)

    left.close()
    right.close()
  })

  it('bounds notification observer diagnostics', async () => {
    const { promise, resolve } = Promise.withResolvers<{ method: string; message: string }>()
    const { left, right } = connectedPeers({ onNotificationObserverError: resolve })
    const method = 'm'.repeat(300)
    right.onNotification(method, () => { throw new Error('x'.repeat(3000)) })

    left.notify(method)
    const diagnostic = await promise
    expect(diagnostic.method).toHaveLength(256)
    expect(diagnostic.method.endsWith('…')).toBe(true)
    expect(diagnostic.message).toHaveLength(2048)
    expect(diagnostic.message.endsWith('…')).toBe(true)

    left.close()
    right.close()
  })
})
