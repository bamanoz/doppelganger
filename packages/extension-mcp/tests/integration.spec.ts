import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server as HttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { ToolRegistry, type JsonValue, type ToolInvocationResult } from '@doppelganger/doppelganger-protocols'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import type { McpPluginConfig } from '../src/config.ts'
import McpImportPlugin from '../src/plugin.ts'

const stdioFixture = fileURLToPath(new URL('./fixtures/stdio-server.mjs', import.meta.url))
const fibersByContext = new Map<Context, readonly Fiber[]>()

async function disposeContext(ctx: Context): Promise<void> {
  const fibers = fibersByContext.get(ctx) ?? []
  fibersByContext.delete(ctx)
  for (const fiber of [...fibers].reverse()) await fiber.dispose()
}

afterEach(async () => {
  const pending = [...fibersByContext.keys()]
  await Promise.allSettled(pending.map(ctx => disposeContext(ctx)))
  for (const key of Object.keys(process.env)) if (key.startsWith('MCP_TEST_')) delete process.env[key]
})

async function setup(config: McpPluginConfig, beforePlugin?: (ctx: Context) => void): Promise<{ ctx: Context; fiber: Fiber }> {
  const ctx = new Context()
  ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: randomUUID(), runtimePresetId: 'mcp-test' }))
  const tools = await ctx.plugin(ToolRegistry)
  beforePlugin?.(ctx)
  const fiber = ctx.plugin(McpImportPlugin, config)
  try {
    await fiber
    fibersByContext.set(ctx, [tools, fiber])
    return { ctx, fiber }
  } catch (cause) {
    await Promise.allSettled([fiber.dispose(), tools.dispose()])
    throw cause
  }
}

function descriptor(ctx: Context, name: string) {
  const found = ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === name)
  if (found === undefined) throw new Error(`missing tool ${name}`)
  return found
}

async function invoke(ctx: Context, name: string, input: JsonValue = {}): Promise<ToolInvocationResult> {
  const tool = descriptor(ctx, name)
  return ctx.doppelgangerTools.invoke({
    callId: randomUUID(),
    name,
    toolRevision: tool.revision,
    input,
  }, 'mcp-integration')
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function waitForServer(ctx: Context, id: string, state: 'active' | 'failed', timeoutMs = 2_000): Promise<void> {
  await waitFor(() => ctx.doppelgangerMcp.snapshot().servers.find(server => server.id === id)?.state === state, timeoutMs)
}

function stdioConfig(): McpPluginConfig {
  return {
    servers: {
      fixture: {
        transport: {
          type: 'stdio',
          command: process.execPath,
          args: [stdioFixture],
          ...(process.env.MCP_TEST_EXIT_MARKER === undefined
            ? {}
            : { environment: { MCP_EXIT_MARKER: { env: 'MCP_TEST_EXIT_MARKER' } } }),
        },
        tools: {
          approval_target: { approval: { policy: 'required' } },
        },
      },
    },
  }
}

async function startHttpFixture(expectedAuthorization: string, options: { readonly discoveryDelayMs?: number } = {}): Promise<{ server: HttpServer; url: string }> {
  const server = createServer(async (request, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end()
      return
    }
    if (request.method === 'GET') {
      response.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
      }))
      return
    }
    if (request.headers.authorization !== expectedAuthorization) {
      response.writeHead(401).end()
      return
    }
    const protocol = new Server({ name: 'http-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
    protocol.setRequestHandler(ListToolsRequestSchema, async () => {
      if (options.discoveryDelayMs !== undefined) await new Promise(resolve => setTimeout(resolve, options.discoveryDelayMs))
      return ({
      tools: [{
        name: 'remote_echo',
        title: 'Remote echo',
        description: 'Echo over stateless HTTP',
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { echoed: { type: 'string' } },
          required: ['echoed'],
          additionalProperties: false,
        },
      }],
      })
    })
    protocol.setRequestHandler(CallToolRequestSchema, async requestMessage => ({
      content: [{ type: 'text', text: String(requestMessage.params.arguments?.value) }],
      structuredContent: { echoed: String(requestMessage.params.arguments?.value) },
    }))
    const transport = new StreamableHTTPServerTransport()
    await protocol.connect(transport as Transport)
    response.on('close', () => {
      void transport.close()
      void protocol.close()
    })
    await transport.handleRequest(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind a TCP port')
  return { server, url: `http://127.0.0.1:${address.port}/mcp` }
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.close(error => error === undefined ? resolve() : reject(error))
  await promise
}

describe.sequential('MCP importer integrations', () => {
  it('imports paginated stdio tools, isolates naming collisions, maps results, refreshes, cancels, and disposes', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.closed`)
    process.env.MCP_TEST_EXIT_MARKER = marker
    const { ctx } = await setup(stdioConfig())
    expect(ctx.doppelgangerMcp.snapshot().servers).toEqual([expect.objectContaining({ id: 'fixture', state: 'connecting', toolCount: 0 })])
    await waitForServer(ctx, 'fixture', 'active')

    const names = ctx.doppelgangerTools.snapshot().tools.map(tool => tool.name)
    expect(names).toContain('mcp-fixture.echo-value')
    expect(names).toContain('mcp-fixture.input-required')
    expect(names).not.toContain('mcp-fixture.read-file')
    expect(ctx.doppelgangerMcp.snapshot().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MCP_TOOL_NAME_COLLISION', serverId: 'fixture' }),
      expect.objectContaining({ code: 'MCP_TOOL_NAME_INVALID', serverId: 'fixture' }),
      expect.objectContaining({ code: 'MCP_TOOL_NAME_TOO_LONG', serverId: 'fixture' }),
    ]))
    expect(await invoke(ctx, 'mcp-fixture.echo-value', { value: 'hello' })).toEqual({
      ok: true,
      value: {
        content: [{ type: 'text', text: 'hello' }],
        structuredContent: { echoed: 'hello' },
      },
    })
    expect(await invoke(ctx, 'mcp-fixture.domain-error')).toMatchObject({
      ok: false,
      error: { code: 'MCP_TOOL_ERROR', data: { content: [{ text: 'fixture domain failure' }] } },
    })
    expect(await invoke(ctx, 'mcp-fixture.input-required')).toMatchObject({
      ok: false,
      error: { code: 'MCP_INPUT_REQUIRED' },
    })
    expect(descriptor(ctx, 'mcp-fixture.approval-target').approval).toEqual({ policy: 'required' })

    expect(await invoke(ctx, 'mcp-fixture.approval-target')).toMatchObject({
      ok: false,
      error: { code: 'TOOL_APPROVAL_REQUIRED' },
    })

    const callId = randomUUID()
    const waiting = descriptor(ctx, 'mcp-fixture.wait-forever')
    const pending = ctx.doppelgangerTools.invoke({ callId, name: waiting.name, toolRevision: waiting.revision, input: {} }, 'mcp-integration')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx.doppelgangerTools.cancel({ callId, reason: 'test cancellation' })).toEqual({ cancelled: true })
    expect(await pending).toMatchObject({ ok: false, error: { code: 'TOOL_CANCELLED' } })

    expect(await invoke(ctx, 'mcp-fixture.trigger-change')).toMatchObject({ ok: true })
    await waitFor(() => ctx.doppelgangerTools.snapshot().tools.some(tool => tool.name === 'mcp-fixture.replacement-tool'))
    expect(ctx.doppelgangerTools.snapshot().tools.filter(tool => tool.name.startsWith('mcp-fixture.')).map(tool => tool.name)).toEqual([
      'mcp-fixture.replacement-tool',
      'mcp-fixture.trigger-invalid-change',
      'mcp-fixture.trigger-invalid-schema',
    ])

    expect(await invoke(ctx, 'mcp-fixture.trigger-invalid-change')).toMatchObject({ ok: true })
    await waitFor(() => ctx.doppelgangerMcp.snapshot().diagnostics.some(diagnostic => diagnostic.code === 'MCP_TOOL_DUPLICATE'))

    expect(await invoke(ctx, 'mcp-fixture.trigger-invalid-schema')).toMatchObject({ ok: true })
    await waitFor(() => ctx.doppelgangerMcp.snapshot().diagnostics.some(diagnostic => diagnostic.code === 'MCP_TOOL_SCHEMA_INVALID'))
    expect(await invoke(ctx, 'mcp-fixture.replacement-tool')).toMatchObject({ ok: true })

    await disposeContext(ctx)
    await waitFor(() => existsSync(marker))
    delete process.env.MCP_TEST_EXIT_MARKER
  })

  it('reports an unavailable configured executable without failing the runtime session', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.closed`)
    process.env.MCP_TEST_EXIT_MARKER = marker
    const { ctx, fiber } = await setup(stdioConfig())
    await waitForServer(ctx, 'fixture', 'active')
    const previous = descriptor(ctx, 'mcp-fixture.echo-value')
    const missing = join(tmpdir(), `missing-mcp-${randomUUID()}`)

    await expect(Promise.resolve(fiber.update({
      servers: {
        fixture: {
          transport: { type: 'stdio', command: missing },
        },
      },
    }))).resolves.toBeUndefined()

    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    expect(ctx.doppelgangerMcp.snapshot().servers).toEqual([expect.objectContaining({ id: 'fixture', state: 'connecting', toolCount: 0 })])
    expect(await ctx.doppelgangerTools.invoke({
      callId: randomUUID(),
      name: previous.name,
      toolRevision: previous.revision,
      input: { value: 'stale' },
    }, 'mcp-integration')).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    await waitForServer(ctx, 'fixture', 'failed')
    expect(ctx.doppelgangerMcp.snapshot().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MCP_SPAWN_FAILED', serverId: 'fixture' }),
    ]))
    await waitFor(() => existsSync(marker))
    await disposeContext(ctx)
    delete process.env.MCP_TEST_EXIT_MARKER
  })
  it('replaces a valid server generation with aliases and disablement', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.closed`)
    process.env.MCP_TEST_EXIT_MARKER = marker
    const { ctx, fiber } = await setup(stdioConfig())
    await waitForServer(ctx, 'fixture', 'active')
    const previous = descriptor(ctx, 'mcp-fixture.echo-value')

    await Promise.resolve(fiber.update({
      servers: {
        fixture: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_EXIT_MARKER: { env: 'MCP_TEST_EXIT_MARKER' } },
          },
          tools: {
            echo_value: { alias: 'echo-renamed' },
            domain_error: { enabled: false },
            Read_File: { alias: 'read-file-upper' },
            'read-file': { alias: 'read-file-lower' },
          },
        },
      },
    }))
    await waitForServer(ctx, 'fixture', 'active')

    const names = ctx.doppelgangerTools.snapshot().tools.map(tool => tool.name)
    expect(names).toContain('mcp-fixture.echo-renamed')
    expect(names).toContain('mcp-fixture.read-file-upper')
    expect(names).toContain('mcp-fixture.read-file-lower')
    expect(names).not.toContain('mcp-fixture.domain-error')
    expect(await invoke(ctx, 'mcp-fixture.echo-renamed', { value: 'replacement' })).toMatchObject({ ok: true })
    expect(await ctx.doppelgangerTools.invoke({
      callId: randomUUID(),
      name: previous.name,
      toolRevision: previous.revision,
      input: { value: 'stale' },
    }, 'mcp-integration')).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })

    await waitFor(() => existsSync(marker))
    await disposeContext(ctx)
    delete process.env.MCP_TEST_EXIT_MARKER
  })

  it('cancels active stdio requests during session disposal', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.closed`)
    process.env.MCP_TEST_EXIT_MARKER = marker
    const { ctx } = await setup(stdioConfig())
    await waitForServer(ctx, 'fixture', 'active')
    const waiting = descriptor(ctx, 'mcp-fixture.wait-forever')
    const pending = ctx.doppelgangerTools.invoke({
      callId: randomUUID(),
      name: waiting.name,
      toolRevision: waiting.revision,
      input: {},
    }, 'mcp-integration')
    await new Promise(resolve => setTimeout(resolve, 20))

    await disposeContext(ctx)
    expect(await pending).toMatchObject({ ok: false, error: { code: 'MCP_CANCELLED' } })
    await waitFor(() => existsSync(marker))
    delete process.env.MCP_TEST_EXIT_MARKER
  })


  it('maps process exit to server unavailability without damaging cleanup', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.closed`)
    process.env.MCP_TEST_EXIT_MARKER = marker
    const { ctx } = await setup(stdioConfig())
    await waitForServer(ctx, 'fixture', 'active')

    expect(await invoke(ctx, 'mcp-fixture.crash-process')).toMatchObject({
      ok: false,
      error: { code: 'MCP_SERVER_UNAVAILABLE' },
    })
    await waitFor(() => ctx.doppelgangerMcp.snapshot().servers[0]?.state === 'failed')
    await disposeContext(ctx)
    await waitFor(() => existsSync(marker))
    delete process.env.MCP_TEST_EXIT_MARKER
  })

  it('uses stateless Streamable HTTP with credential references and untrusted annotations', async () => {
    process.env.MCP_TEST_AUTHORIZATION = 'Bearer fixture-secret'
    const fixture = await startHttpFixture(process.env.MCP_TEST_AUTHORIZATION)
    try {
      const { ctx } = await setup({
        servers: {
          remote: {
            transport: {
              type: 'streamable-http',
              url: fixture.url,
              headers: { Authorization: { env: 'MCP_TEST_AUTHORIZATION' } },
            },
          },
        },
      })
      await waitForServer(ctx, 'remote', 'active')
      const remote = descriptor(ctx, 'mcp-remote.remote-echo')
      expect(remote.approval).toBeUndefined()
      expect(await invoke(ctx, remote.name, { value: 'http' })).toEqual({
        ok: true,
        value: {
          content: [{ type: 'text', text: 'http' }],
          structuredContent: { echoed: 'http' },
        },
      })
      expect(ctx.get('doppelgangerActor')).toBeUndefined()
      expect(JSON.stringify(ctx.doppelgangerMcp.snapshot())).not.toContain('fixture-secret')
      await disposeContext(ctx)
    } finally {
      delete process.env.MCP_TEST_AUTHORIZATION
      await closeHttpServer(fixture.server)
    }
  })

  it('activates the plugin while an MCP server is still connecting', async () => {
    process.env.MCP_TEST_AUTHORIZATION = 'Bearer delayed-secret'
    const fixture = await startHttpFixture(process.env.MCP_TEST_AUTHORIZATION, { discoveryDelayMs: 150 })
    try {
      const { ctx } = await setup({
        servers: {
          delayed: {
            transport: {
              type: 'streamable-http',
              url: fixture.url,
              headers: { Authorization: { env: 'MCP_TEST_AUTHORIZATION' } },
            },
          },
        },
      })
      expect(ctx.doppelgangerMcp.snapshot().servers).toEqual([
        expect.objectContaining({ id: 'delayed', state: 'connecting', toolCount: 0 }),
      ])
      expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
      await waitForServer(ctx, 'delayed', 'active')
    } finally {
      await closeHttpServer(fixture.server)
    }
  })

  it('publishes each server independently while another server is still connecting', async () => {
    process.env.MCP_TEST_SLOW_INITIALIZE = '180'
    const { ctx } = await setup({
      servers: {
        ready: { transport: { type: 'stdio', command: process.execPath, args: [stdioFixture] } },
        slow: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_INITIALIZE_DELAY_MS: { env: 'MCP_TEST_SLOW_INITIALIZE' } },
          },
        },
      },
    })
    await waitForServer(ctx, 'ready', 'active')
    expect(ctx.doppelgangerMcp.snapshot().servers.find(server => server.id === 'slow')).toMatchObject({ state: 'connecting', toolCount: 0 })
    expect(ctx.doppelgangerTools.snapshot().tools.some(tool => tool.name === 'mcp-ready.echo-value')).toBe(true)
    expect(ctx.doppelgangerTools.snapshot().tools.some(tool => tool.name.startsWith('mcp-slow.'))).toBe(false)
    await waitForServer(ctx, 'slow', 'active')
  })

  it('uses the exact configured MCP command without managing its package or version', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.args`)
    process.env.MCP_TEST_ARGUMENT_MARKER = marker
    const authoredArgs = [stdioFixture, '--channel', 'next', 'two words']
    const { ctx } = await setup({
      servers: {
        exact: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: authoredArgs,
            environment: { MCP_ARGUMENT_MARKER: { env: 'MCP_TEST_ARGUMENT_MARKER' } },
          },
        },
      },
    })
    await waitForServer(ctx, 'exact', 'active')
    expect(JSON.parse(readFileSync(marker, 'utf8').trim())).toEqual(authoredArgs.slice(1))
  })

  it('contains startup failure to one MCP server generation', async () => {
    const { ctx } = await setup({
      servers: {
        healthy: { transport: { type: 'stdio', command: process.execPath, args: [stdioFixture] } },
        unavailable: { transport: { type: 'stdio', command: join(tmpdir(), `missing-mcp-${randomUUID()}`) } },
      },
    })
    await Promise.all([
      waitForServer(ctx, 'healthy', 'active'),
      waitForServer(ctx, 'unavailable', 'failed'),
    ])
    expect(ctx.doppelgangerTools.snapshot().tools.some(tool => tool.name === 'mcp-healthy.echo-value')).toBe(true)
    expect(ctx.doppelgangerTools.snapshot().tools.some(tool => tool.name.startsWith('mcp-unavailable.'))).toBe(false)
    expect(await invoke(ctx, 'mcp-healthy.echo-value', { value: 'usable' })).toMatchObject({ ok: true })
  })

  it('times out and disposes a server that never completes initialization', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.closed`)
    process.env.MCP_TEST_EXIT_MARKER = marker
    process.env.MCP_TEST_INITIALIZE_DELAY = '200'
    const { ctx } = await setup({
      servers: {
        timeout: {
          startupTimeoutMs: 30,
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: {
              MCP_EXIT_MARKER: { env: 'MCP_TEST_EXIT_MARKER' },
              MCP_INITIALIZE_DELAY_MS: { env: 'MCP_TEST_INITIALIZE_DELAY' },
            },
          },
        },
      },
    })
    await waitForServer(ctx, 'timeout', 'failed')
    expect(ctx.doppelgangerMcp.snapshot().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ serverId: 'timeout', code: 'MCP_INITIALIZE_TIMEOUT' }),
    ]))
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    await waitFor(() => existsSync(marker))
  })

  it('distinguishes initial discovery failure from transport startup failure', async () => {
    process.env.MCP_TEST_INITIAL_DISCOVERY_MODE = 'duplicate'
    const { ctx } = await setup({
      servers: {
        invalid: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_INITIAL_DISCOVERY_MODE: { env: 'MCP_TEST_INITIAL_DISCOVERY_MODE' } },
          },
        },
      },
    })
    await waitForServer(ctx, 'invalid', 'failed')
    const diagnostics = ctx.doppelgangerMcp.snapshot().diagnostics
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ serverId: 'invalid', code: 'MCP_TOOL_DUPLICATE' }),
    ]))
    expect(diagnostics.some(diagnostic => ['MCP_SPAWN_FAILED', 'MCP_INITIALIZE_FAILED'].includes(diagnostic.code))).toBe(false)
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
  })

  it('publishes one atomic catalog change after background initial discovery', async () => {
    process.env.MCP_TEST_DISCOVERY_DELAY = '80'
    const revisions: string[] = []
    const { ctx } = await setup({
      servers: {
        atomic: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_DISCOVERY_DELAY_MS: { env: 'MCP_TEST_DISCOVERY_DELAY' } },
          },
        },
      },
    }, context => {
      context.on('doppelganger/tools-changed', revision => { revisions.push(revision) })
    })
    expect(revisions).toEqual([])
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    await waitForServer(ctx, 'atomic', 'active')
    expect(revisions).toHaveLength(1)
    expect(ctx.doppelgangerTools.snapshot().tools.filter(tool => tool.name.startsWith('mcp-atomic.')).length).toBeGreaterThan(1)
  })

  it('withdraws imported tools when an active server transport closes', async () => {
    const { ctx } = await setup(stdioConfig())
    await waitForServer(ctx, 'fixture', 'active')
    const previous = descriptor(ctx, 'mcp-fixture.echo-value')

    expect(await invoke(ctx, 'mcp-fixture.crash-process')).toMatchObject({
      ok: false,
      error: { code: 'MCP_SERVER_UNAVAILABLE' },
    })
    await waitForServer(ctx, 'fixture', 'failed')
    expect(ctx.doppelgangerTools.snapshot().tools.some(tool => tool.name.startsWith('mcp-fixture.'))).toBe(false)
    expect(await ctx.doppelgangerTools.invoke({
      callId: randomUUID(),
      name: previous.name,
      toolRevision: previous.revision,
      input: { value: 'stale' },
    }, 'mcp-integration')).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    expect(ctx.doppelgangerMcp.snapshot().diagnostics.filter(diagnostic => diagnostic.code === 'MCP_TRANSPORT_CLOSED')).toHaveLength(1)
  })

  it('replaces changed MCP configuration with a background generation', async () => {
    process.env.MCP_TEST_REPLACEMENT_DELAY = '100'
    const { ctx, fiber } = await setup(stdioConfig())
    await waitForServer(ctx, 'fixture', 'active')
    const previous = descriptor(ctx, 'mcp-fixture.echo-value')

    await Promise.resolve(fiber.update({
      servers: {
        fixture: {
          startupTimeoutMs: 500,
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_INITIALIZE_DELAY_MS: { env: 'MCP_TEST_REPLACEMENT_DELAY' } },
          },
          tools: { echo_value: { alias: 'replacement-echo' } },
        },
      },
    }))

    expect(ctx.doppelgangerMcp.snapshot().servers).toEqual([expect.objectContaining({ id: 'fixture', state: 'connecting', toolCount: 0 })])
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    expect(await ctx.doppelgangerTools.invoke({
      callId: randomUUID(),
      name: previous.name,
      toolRevision: previous.revision,
      input: { value: 'stale' },
    }, 'mcp-integration')).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    await waitForServer(ctx, 'fixture', 'active')
    expect(descriptor(ctx, 'mcp-fixture.replacement-echo')).toBeDefined()
  })

  it('ignores a stale startup result after server replacement', async () => {
    process.env.MCP_TEST_STALE_DELAY = '160'
    const { ctx, fiber } = await setup({
      servers: {
        fixture: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_DISCOVERY_DELAY_MS: { env: 'MCP_TEST_STALE_DELAY' } },
          },
          tools: { echo_value: { alias: 'stale-echo' } },
        },
      },
    })
    expect(ctx.doppelgangerMcp.snapshot().servers[0]).toMatchObject({ state: 'connecting' })

    await Promise.resolve(fiber.update({
      servers: {
        fixture: {
          transport: { type: 'stdio', command: process.execPath, args: [stdioFixture] },
          tools: { echo_value: { alias: 'current-echo' } },
        },
      },
    }))
    await waitForServer(ctx, 'fixture', 'active')
    await new Promise(resolve => setTimeout(resolve, 220))
    const names = ctx.doppelgangerTools.snapshot().tools.map(tool => tool.name)
    expect(names).toContain('mcp-fixture.current-echo')
    expect(names).not.toContain('mcp-fixture.stale-echo')
  })

  it('disposes a connecting generation without a late tool commit or retained process', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.closed`)
    process.env.MCP_TEST_EXIT_MARKER = marker
    process.env.MCP_TEST_DISCOVERY_DELAY = '180'
    const revisions: string[] = []
    const { ctx } = await setup({
      servers: {
        connecting: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: {
              MCP_EXIT_MARKER: { env: 'MCP_TEST_EXIT_MARKER' },
              MCP_DISCOVERY_DELAY_MS: { env: 'MCP_TEST_DISCOVERY_DELAY' },
            },
          },
        },
      },
    }, context => {
      context.on('doppelganger/tools-changed', revision => { revisions.push(revision) })
    })
    const tools = ctx.doppelgangerTools
    expect(ctx.doppelgangerMcp.snapshot().servers[0]).toMatchObject({ state: 'connecting' })
    await disposeContext(ctx)
    await waitFor(() => existsSync(marker))
    await new Promise(resolve => setTimeout(resolve, 220))
    expect(revisions).toEqual([])
    expect(tools.snapshot().tools).toEqual([])
  })

  it('times out during initial discovery with a stage-specific diagnostic', async () => {
    process.env.MCP_TEST_DISCOVERY_DELAY = '400'
    const { ctx } = await setup({
      servers: {
        discovery: {
          startupTimeoutMs: 150,
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_DISCOVERY_DELAY_MS: { env: 'MCP_TEST_DISCOVERY_DELAY' } },
          },
        },
      },
    })
    await waitForServer(ctx, 'discovery', 'failed')
    expect(ctx.doppelgangerMcp.snapshot().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ serverId: 'discovery', code: 'MCP_DISCOVERY_TIMEOUT' }),
    ]))
  })

  it('retains an unchanged generation across a valid asynchronous reload', async () => {
    const { ctx, fiber } = await setup(stdioConfig())
    await waitForServer(ctx, 'fixture', 'active')
    const before = descriptor(ctx, 'mcp-fixture.echo-value')

    await Promise.resolve(fiber.update(stdioConfig()))

    const after = descriptor(ctx, 'mcp-fixture.echo-value')
    expect(ctx.doppelgangerMcp.snapshot().servers[0]).toMatchObject({ state: 'active' })
    expect(after.revision).toBe(before.revision)
    expect(await invoke(ctx, after.name, { value: 'retained' })).toMatchObject({ ok: true })
  })

  it('disposes a serialized refresh without a late catalog mutation', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.closed`)
    process.env.MCP_TEST_EXIT_MARKER = marker
    process.env.MCP_TEST_REFRESH_DELAY = '180'
    const revisions: string[] = []
    const { ctx } = await setup({
      servers: {
        fixture: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: {
              MCP_EXIT_MARKER: { env: 'MCP_TEST_EXIT_MARKER' },
              MCP_REFRESH_DELAY_MS: { env: 'MCP_TEST_REFRESH_DELAY' },
            },
          },
        },
      },
    }, context => {
      context.on('doppelganger/tools-changed', revision => { revisions.push(revision) })
    })
    await waitForServer(ctx, 'fixture', 'active')
    const tools = ctx.doppelgangerTools
    expect(await invoke(ctx, 'mcp-fixture.trigger-change')).toMatchObject({ ok: true })
    await disposeContext(ctx)
    const revisionCount = revisions.length
    await waitFor(() => existsSync(marker))
    await new Promise(resolve => setTimeout(resolve, 220))
    expect(revisions).toHaveLength(revisionCount)
    expect(tools.snapshot().tools).toEqual([])
  })

  it('disposes a generation while MCP initialization is pending', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.closed`)
    process.env.MCP_TEST_EXIT_MARKER = marker
    process.env.MCP_TEST_INITIALIZE_DELAY = '180'
    const { ctx } = await setup({
      servers: {
        initializing: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: {
              MCP_EXIT_MARKER: { env: 'MCP_TEST_EXIT_MARKER' },
              MCP_INITIALIZE_DELAY_MS: { env: 'MCP_TEST_INITIALIZE_DELAY' },
            },
          },
        },
      },
    })
    expect(ctx.doppelgangerMcp.snapshot().servers[0]).toMatchObject({ state: 'connecting' })
    await disposeContext(ctx)
    await waitFor(() => existsSync(marker))
  })

  it('observes spawn failure cleanup without retrying the configured command', async () => {
    const missing = join(tmpdir(), `missing-mcp-${randomUUID()}`)
    const { ctx } = await setup({
      servers: {
        spawn: { transport: { type: 'stdio', command: missing } },
      },
    })
    await waitForServer(ctx, 'spawn', 'failed')
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(ctx.doppelgangerMcp.snapshot().diagnostics.filter(diagnostic => diagnostic.code === 'MCP_SPAWN_FAILED')).toHaveLength(1)
  })

  it('rejects invalid startup mode before starting any MCP server', async () => {
    const marker = join(tmpdir(), `doppelganger-mcp-${randomUUID()}.args`)
    process.env.MCP_TEST_ARGUMENT_MARKER = marker
    let context: Context | undefined

    await expect(setup({
      startupMode: 'invalid',
      servers: {
        fixture: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_ARGUMENT_MARKER: { env: 'MCP_TEST_ARGUMENT_MARKER' } },
          },
        },
      },
    } as unknown as McpPluginConfig, ctx => { context = ctx })).rejects.toThrow('must be "background" or "await-ready"')

    expect(existsSync(marker)).toBe(false)
    expect(context?.get('doppelgangerMcp', false)).toBeUndefined()
  })

  it('treats an empty enabled MCP set as ready in await-ready mode', async () => {
    const { ctx } = await setup({
      startupMode: 'await-ready',
      servers: {
        disabled: {
          enabled: false,
          transport: { type: 'stdio', command: join(tmpdir(), `missing-mcp-${randomUUID()}`) },
        },
      },
    })

    expect(ctx.doppelgangerMcp.snapshot()).toMatchObject({ servers: [], diagnostics: [] })
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
  })

  it('completes stdio and HTTP catalogs before await-ready apply returns', async () => {
    process.env.MCP_TEST_AUTHORIZATION = 'Bearer await-ready-secret'
    const fixture = await startHttpFixture(process.env.MCP_TEST_AUTHORIZATION, { discoveryDelayMs: 80 })
    try {
      const { ctx } = await setup({
        startupMode: 'await-ready',
        servers: {
          local: { transport: { type: 'stdio', command: process.execPath, args: [stdioFixture] } },
          remote: {
            transport: {
              type: 'streamable-http',
              url: fixture.url,
              headers: { Authorization: { env: 'MCP_TEST_AUTHORIZATION' } },
            },
          },
        },
      })

      expect(ctx.doppelgangerMcp.snapshot().servers).toEqual([
        expect.objectContaining({ id: 'local', state: 'active' }),
        expect.objectContaining({ id: 'remote', state: 'active' }),
      ])
      const names = ctx.doppelgangerTools.snapshot().tools.map(tool => tool.name)
      expect(names).toContain('mcp-local.echo-value')
      expect(names).toContain('mcp-remote.remote-echo')
    } finally {
      await closeHttpServer(fixture.server)
    }
  })

  it('publishes the MCP service before await-ready external work completes', async () => {
    process.env.MCP_TEST_SLOW_INITIALIZE = '180'
    const ctx = new Context()
    ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: randomUUID(), runtimePresetId: 'mcp-test' }))
    const tools = await ctx.plugin(ToolRegistry)
    const fiber = ctx.plugin(McpImportPlugin, {
      startupMode: 'await-ready',
      servers: {
        slow: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_INITIALIZE_DELAY_MS: { env: 'MCP_TEST_SLOW_INITIALIZE' } },
          },
        },
      },
    })
    let settled = false
    const activation = fiber.await().finally(() => { settled = true })
    fibersByContext.set(ctx, [tools, fiber])

    await waitFor(() => ctx.get('doppelgangerMcp', false) !== undefined)
    expect(settled).toBe(false)
    expect(ctx.doppelgangerMcp.snapshot().servers).toEqual([
      expect.objectContaining({ id: 'slow', state: 'connecting' }),
    ])
    await activation
    expect(ctx.doppelgangerMcp.snapshot().servers[0]).toMatchObject({ state: 'active' })
  })

  it('accepts an active await-ready MCP server with zero tools', async () => {
    process.env.MCP_TEST_EMPTY_DISCOVERY = 'empty'
    const { ctx } = await setup({
      startupMode: 'await-ready',
      servers: {
        empty: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_INITIAL_DISCOVERY_MODE: { env: 'MCP_TEST_EMPTY_DISCOVERY' } },
          },
        },
      },
    })

    expect(ctx.doppelgangerMcp.snapshot().servers).toEqual([
      expect.objectContaining({ id: 'empty', state: 'active', toolCount: 0 }),
    ])
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
  })

  it('retains an unchanged MCP generation after await-ready activation', async () => {
    const config: McpPluginConfig = {
      startupMode: 'await-ready',
      servers: {
        fixture: { transport: { type: 'stdio', command: process.execPath, args: [stdioFixture] } },
      },
    }
    const { ctx, fiber } = await setup(config)
    const before = descriptor(ctx, 'mcp-fixture.echo-value')

    await Promise.resolve(fiber.update({ ...config, startupMode: 'background' }))

    expect(ctx.doppelgangerMcp.snapshot().servers[0]).toMatchObject({ state: 'active' })
    expect(descriptor(ctx, 'mcp-fixture.echo-value').revision).toBe(before.revision)
  })

  it('keeps in-place MCP updates background after await-ready activation', async () => {
    process.env.MCP_TEST_REPLACEMENT_DELAY = '180'
    const { ctx, fiber } = await setup({
      startupMode: 'await-ready',
      servers: {
        fixture: { transport: { type: 'stdio', command: process.execPath, args: [stdioFixture] } },
      },
    })

    await Promise.resolve(fiber.update({
      startupMode: 'await-ready',
      servers: {
        fixture: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_INITIALIZE_DELAY_MS: { env: 'MCP_TEST_REPLACEMENT_DELAY' } },
          },
          tools: { echo_value: { alias: 'replacement-echo' } },
        },
      },
    }))

    expect(ctx.doppelgangerMcp.snapshot().servers[0]).toMatchObject({ state: 'connecting', toolCount: 0 })
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    await waitForServer(ctx, 'fixture', 'active')
    expect(descriptor(ctx, 'mcp-fixture.replacement-echo')).toBeDefined()

    await Promise.resolve(fiber.update({
      startupMode: 'await-ready',
      servers: {
        fixture: { transport: { type: 'stdio', command: join(tmpdir(), `missing-mcp-${randomUUID()}`) } },
      },
    }))
    await waitForServer(ctx, 'fixture', 'failed')
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
  })

  it('ignores stale startup after replacing a server in an await-ready row', async () => {
    process.env.MCP_TEST_STALE_DELAY = '180'
    const { ctx, fiber } = await setup({
      startupMode: 'await-ready',
      servers: {
        fixture: { transport: { type: 'stdio', command: process.execPath, args: [stdioFixture] } },
      },
    })

    await Promise.resolve(fiber.update({
      startupMode: 'await-ready',
      servers: {
        fixture: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [stdioFixture],
            environment: { MCP_DISCOVERY_DELAY_MS: { env: 'MCP_TEST_STALE_DELAY' } },
          },
          tools: { echo_value: { alias: 'stale-await-ready' } },
        },
      },
    }))
    expect(ctx.doppelgangerMcp.snapshot().servers[0]).toMatchObject({ state: 'connecting' })

    await Promise.resolve(fiber.update({
      startupMode: 'background',
      servers: {
        fixture: {
          transport: { type: 'stdio', command: process.execPath, args: [stdioFixture] },
          tools: { echo_value: { alias: 'current-await-ready' } },
        },
      },
    }))
    await waitForServer(ctx, 'fixture', 'active')
    await new Promise(resolve => setTimeout(resolve, 220))
    const names = ctx.doppelgangerTools.snapshot().tools.map(tool => tool.name)
    expect(names).toContain('mcp-fixture.current-await-ready')
    expect(names).not.toContain('mcp-fixture.stale-await-ready')
  })

  it('disposes while an unavailable executable spawn is still settling', async () => {
    const { ctx } = await setup({
      servers: {
        settling: { transport: { type: 'stdio', command: join(tmpdir(), `missing-mcp-${randomUUID()}`) } },
      },
    })
    const tools = ctx.doppelgangerTools
    await disposeContext(ctx)
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(tools.snapshot().tools).toEqual([])
  })
})
