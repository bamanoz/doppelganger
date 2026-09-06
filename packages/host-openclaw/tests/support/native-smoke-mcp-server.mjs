import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const marker = process.env.DOPPELGANGER_OPENCLAW_SMOKE_MARKER
const phase = process.env.DOPPELGANGER_OPENCLAW_SMOKE_RUNTIME === '1' ? 'gateway' : 'prepare'

function record(event) {
  if (marker) appendFileSync(marker, `${JSON.stringify({ ...event, phase })}\n`)
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function handle(message) {
  const { id, method, params } = message
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'doppelganger-openclaw-native-smoke', version: '1.0.0' },
      },
    })
    return
  }
  if (method === 'notifications/initialized') return
  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [{
          name: 'smoke_echo',
          title: 'Native Smoke MCP Echo',
          description: 'Echoes one value through the awaited MCP import path',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['value'],
            properties: { value: { type: 'string' } },
          },
        }],
      },
    })
    return
  }
  if (method === 'tools/call' && params?.name === 'smoke_echo') {
    record({ event: 'mcp-call', value: params.arguments?.value })
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: String(params.arguments?.value ?? '') }],
        structuredContent: { echoed: params.arguments?.value ?? null },
      },
    })
    return
  }
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unsupported method ${String(method)}` } })
  }
}

let exited = false
function recordExit() {
  if (exited) return
  exited = true
  record({ event: 'mcp-exit' })
}

process.once('SIGTERM', () => process.exit(0))
process.once('SIGINT', () => process.exit(0))
process.once('exit', recordExit)

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', line => {
  void handle(JSON.parse(line)).catch(error => {
    record({ event: 'mcp-error', message: error instanceof Error ? error.message : String(error) })
    process.exitCode = 1
  })
})
