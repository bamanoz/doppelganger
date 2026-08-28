import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  ContentLengthDecoder,
  FramedJsonRpcPeer,
  RpcProtocolError,
  encodeRpcMessage,
} from '../src/index.ts'

function connectedPeers() {
  const leftToRight = new PassThrough()
  const rightToLeft = new PassThrough()
  return {
    left: new FramedJsonRpcPeer(rightToLeft, leftToRight),
    right: new FramedJsonRpcPeer(leftToRight, rightToLeft),
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
})
