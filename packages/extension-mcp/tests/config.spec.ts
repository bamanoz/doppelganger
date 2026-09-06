import { describe, expect, it } from 'vitest'
import { normalizeMcpPluginConfig } from '../src/config.ts'

describe('MCP Loader configuration', () => {
  it('normalizes stdio, stateless HTTP, references, aliases, disablement, and approval', () => {
    const config = normalizeMcpPluginConfig({
      servers: {
        filesystem: {
          startupTimeoutMs: 90_000,
          transport: {
            type: 'stdio',
            command: 'filesystem-mcp',
            args: ['/workspace'],
            cwd: '/tmp',
            environment: { TOKEN: { env: 'MCP_TOKEN' } },
          },
          tools: {
            Read_File: { alias: 'read-file-safe', approval: { policy: 'required', reason: 'Reads local files' } },
            write_file: { approval: { policy: 'required' } },
            delete_file: { enabled: false },
          },
        },
        remote: {
          enabled: false,
          transport: {
            type: 'streamable-http',
            url: 'https://example.test/mcp',
            headers: { Authorization: { env: 'MCP_AUTHORIZATION' } },
          },
        },
      },
    })

    expect(config).toEqual({
      startupMode: 'background',
      servers: [
        {
          id: 'filesystem',
          startupTimeoutMs: 90_000,
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'filesystem-mcp',
            args: ['/workspace'],
            cwd: '/tmp',
            environment: { TOKEN: { env: 'MCP_TOKEN' } },
          },
          tools: {
            Read_File: {
              enabled: true,
              alias: 'read-file-safe',
              approval: { policy: 'required', reason: 'Reads local files' },
            },
            write_file: { enabled: true, approval: { policy: 'required' } },
            delete_file: { enabled: false },
          },
        },
        {
          id: 'remote',
          startupTimeoutMs: 60_000,
          enabled: false,
          transport: {
            type: 'streamable-http',
            url: 'https://example.test/mcp',
            headers: { Authorization: { env: 'MCP_AUTHORIZATION' } },
          },
          tools: {},
        },
      ],
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(JSON.stringify(config)).not.toContain('secret-value')
  })

  it('defaults MCP startup mode to background', () => {
    expect(normalizeMcpPluginConfig({ servers: {} }).startupMode).toBe('background')
  })

  it('accepts await-ready MCP startup mode', () => {
    expect(normalizeMcpPluginConfig({ startupMode: 'await-ready', servers: {} }).startupMode).toBe('await-ready')
  })

  it('defaults and bounds startup timeout without interpreting operator-owned acquisition', () => {
    const defaults = normalizeMcpPluginConfig({
      servers: {
        package: {
          transport: { type: 'stdio', command: 'npx', args: ['-y', '@example/mcp-server@next'] },
        },
        remote: {
          startupTimeoutMs: 600_000,
          transport: { type: 'streamable-http', url: 'https://example.test/mcp' },
        },
      },
    })

    expect(defaults.servers[0]).toMatchObject({
      id: 'package',
      startupTimeoutMs: 60_000,
      transport: { command: 'npx', args: ['-y', '@example/mcp-server@next'] },
    })
    expect(defaults.servers[1]).toMatchObject({ id: 'remote', startupTimeoutMs: 600_000 })
    expect(defaults.servers[0]).not.toHaveProperty('install')
    expect(defaults.servers[0]).not.toHaveProperty('version')
    expect(defaults.servers[0]).not.toHaveProperty('fallback')
  })

  it.each([
    [{ startupMode: 'eventually', servers: {} }, 'must be "background" or "await-ready"'],
    [{ servers: { Bad_ID: { transport: { type: 'stdio', command: 'server' } } } }, 'lowercase kebab-case'],
    [{ servers: { good: { transport: { type: 'stdio', command: '' } } } }, 'command'],
    [{ servers: { good: { transport: { type: 'stdio', command: 'server', cwd: 'relative' } } } }, 'absolute path'],
    [{ servers: { good: { transport: { type: 'streamable-http', url: 'file:///tmp/mcp' } } } }, 'HTTP or HTTPS'],
    [{ servers: { good: { transport: { type: 'streamable-http', url: 'https://user:pass@example.test/mcp' } } } }, 'credentials'],
    [{ servers: { good: { transport: { type: 'stdio', command: 'server', environment: { TOKEN: { env: 'bad-name' } } } } } }, 'environment variable'],
    [{ servers: { good: { transport: { type: 'stdio', command: 'server' }, tools: { exact: { alias: 'Bad_Alias' } } } } }, 'lowercase kebab-case'],
    [{ servers: { good: { transport: { type: 'stdio', command: 'server' }, tools: { exact: { approval: { policy: 'optional', reason: 'x' } } } } } }, 'must be "required"'],
    [{ servers: { good: { transport: { type: 'stdio', command: 'server' }, tools: { exact: { approval: { policy: 'required', reason: ' ' } } } } } }, 'must contain 1-1024 characters'],

    [{ servers: { good: { transport: { type: 'stdio', command: 'server' }, unsupported: true } } }, 'unsupported fields'],
    [{ servers: { good: { startupTimeoutMs: 0, transport: { type: 'stdio', command: 'server' } } } }, 'integer between 1 and 600000'],
    [{ servers: { good: { startupTimeoutMs: 600_001, transport: { type: 'stdio', command: 'server' } } } }, 'integer between 1 and 600000'],
    [{ servers: { good: { startupTimeoutMs: 1.5, transport: { type: 'stdio', command: 'server' } } } }, 'integer between 1 and 600000'],
    [{ servers: { good: { transport: { type: 'stdio', command: 'server' }, tools: { exact: { inputSchema: {} } } } } }, 'unsupported fields'],
  ])('rejects invalid configuration at the owning boundary', (input, message) => {
    expect(() => normalizeMcpPluginConfig(input)).toThrow(message)
  })
})
