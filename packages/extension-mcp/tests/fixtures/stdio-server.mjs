import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

let changed = 0
let stopping = false

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

if (process.env.MCP_ARGUMENT_MARKER) {
  appendFileSync(process.env.MCP_ARGUMENT_MARKER, `${JSON.stringify(process.argv.slice(2))}\n`)
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function tool(name, description = name, inputSchema = { type: 'object', additionalProperties: false }) {
  return { name, description, inputSchema }
}

function tools(cursor) {
  if (process.env.MCP_INITIAL_DISCOVERY_MODE === 'empty') return { tools: [] }
  if (process.env.MCP_INITIAL_DISCOVERY_MODE === 'duplicate') return { tools: [tool('duplicate'), tool('duplicate')] }
  if (process.env.MCP_INITIAL_DISCOVERY_MODE === 'invalid-schema') {
    return { tools: [tool('invalid_schema', 'invalid', { type: 'object', properties: { value: { type: 'not-a-json-type' } } })] }
  }
  if (changed === 3) return { tools: [tool('invalid_schema', 'invalid', { type: 'object', properties: { value: { type: 'not-a-json-type' } } })] }
  if (changed === 2) return { tools: [tool('duplicate'), tool('duplicate')] }
  if (changed === 1) return { tools: [tool('replacement_tool'), tool('trigger_invalid_change'), tool('trigger_invalid_schema')] }
  if (cursor === undefined) {
    return {
      tools: [
        tool('echo_value', 'Echo arguments', {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        }),
        tool('Read_File'),
        tool('read-file'),
        tool('domain_error'),
        tool('space name'),
        tool('a'.repeat(200)),
      ],
      nextCursor: 'page-two',
    }
  }
  if (cursor === 'page-two') {
    return {
      tools: [
        tool('approval_target'),
        tool('input_required'),
        tool('wait_forever'),
        tool('trigger_change'),
        tool('crash_process'),
      ],
    }
  }
  throw new Error(`unexpected cursor ${cursor}`)
}

async function request(message) {
  const { id, method, params } = message
  if (method === 'initialize' && process.env.MCP_INITIALIZE_DELAY_MS) {
    await wait(Number(process.env.MCP_INITIALIZE_DELAY_MS))
  }
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'stdio-fixture', version: '1.0.0' },
      },
    })
    return
  }
  if (method === 'tools/list') {
    const delay = changed > 0 ? process.env.MCP_REFRESH_DELAY_MS : process.env.MCP_DISCOVERY_DELAY_MS
    if (delay) await wait(Number(delay))
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: tools(params?.cursor) })
    return
  }
  if (method !== 'tools/call') {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unsupported method ${method}` } })
    return
  }
  if (params.name === 'echo_value') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: String(params.arguments?.value) }],
        structuredContent: { echoed: params.arguments?.value },
      },
    })
    return
  }
  if (params.name === 'domain_error') {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'fixture domain failure' }], isError: true } })
    return
  }
  if (params.name === 'input_required') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        resultType: 'input_required',
        content: [{ type: 'text', text: 'supply more input' }],
        requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } },
      },
    })
    return
  }
  if (params.name === 'trigger_change') {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'changing' }] } })
    changed = 1
    setTimeout(() => send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }), 5)
    return
  }
  if (params.name === 'approval_target') {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'approved' }] } })
    return
  }
  if (params.name === 'trigger_invalid_change') {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'invalidating' }] } })
    changed = 2
    setTimeout(() => send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }), 5)
    return
  }
  if (params.name === 'trigger_invalid_schema') {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'invalid schema' }] } })
    changed = 3
    setTimeout(() => send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }), 5)
    return
  }
  if (params.name === 'crash_process') {
    process.exit(23)
  }
  if (params.name === 'wait_forever') return
  if (params.name === 'replacement_tool') {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'replacement' }] } })
    return
  }
  send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${params.name}` } })
}

function recordExit() {
  if (stopping) return
  stopping = true
  if (process.env.MCP_EXIT_MARKER) appendFileSync(process.env.MCP_EXIT_MARKER, 'closed\n')
}

process.on('SIGTERM', () => {
  recordExit()
  process.exit(0)
})
process.on('exit', recordExit)

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', line => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if ('id' in message) void request(message)
})
