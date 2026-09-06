import { describe, expect, it, vi } from 'vitest'
import type { ToolCatalogSnapshot, ToolDescriptor } from '@doppelganger/doppelganger-protocols'
import {
  nativeToolName,
  prepareCatalog,
  projectCatalog,
  validatePreparedCatalog,
} from '../src/catalog.ts'

function descriptor(
  name: string,
  revision = 'runtime-revision-1',
  inputSchema: ToolDescriptor['inputSchema'] = { type: 'object', properties: {}, additionalProperties: false },
): ToolDescriptor {
  return Object.freeze({
    name,
    label: `Label ${name}`,
    description: `Description ${name}`,
    inputSchema,
    revision,
    available: true,
  })
}

function snapshot(...tools: ToolDescriptor[]): ToolCatalogSnapshot {
  return Object.freeze({ revision: 'catalog-process-revision', tools: Object.freeze(tools) })
}

describe('prepared OpenClaw catalogs', () => {
  it('prepares deterministic exact contracts without persisting opaque runtime revisions', () => {
    const prepared = prepareCatalog('portable', snapshot(
      descriptor('zeta.read', 'opaque-zeta'),
      { ...descriptor('memory.search', 'opaque-memory'), approval: { policy: 'required', reason: 'Review recall' } },
    ))

    expect(prepared).toEqual({
      version: 1,
      runtimePresetId: 'portable',
      tools: [
        {
          nativeName: 'dg_memory__search',
          descriptor: {
            name: 'memory.search',
            label: 'Label memory.search',
            description: 'Description memory.search',
            inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
            approval: { policy: 'required', reason: 'Review recall' },
            available: true,
          },
        },
        {
          nativeName: 'dg_zeta__read',
          descriptor: {
            name: 'zeta.read',
            label: 'Label zeta.read',
            description: 'Description zeta.read',
            inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
            available: true,
          },
        },
      ],
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(prepared)).not.toContain('opaque-')
    expect(prepareCatalog('portable', snapshot(
      descriptor('memory.search', 'another-process-revision'),
      descriptor('zeta.read', 'another-zeta-revision'),
    )).fingerprint).toBe(prepareCatalog('portable', snapshot(
      descriptor('memory.search', 'third-process-revision'),
      descriptor('zeta.read', 'third-zeta-revision'),
    )).fingerprint)
    expect(validatePreparedCatalog(JSON.parse(JSON.stringify(prepared)))).toEqual(prepared)
    expect(Object.isFrozen(prepared.tools[0]!.descriptor.inputSchema)).toBe(true)
  })

  it('rejects noncanonical mappings, tampering, unsupported schema semantics and host name limits', () => {
    const prepared = prepareCatalog('portable', snapshot(descriptor('memory.search')))
    expect(() => prepareCatalog('Not Portable', snapshot())).toThrow('lowercase kebab-case')
    expect(() => validatePreparedCatalog({ ...prepared, fingerprint: '0'.repeat(64) })).toThrow('fingerprint')
    expect(() => validatePreparedCatalog({
      ...prepared,
      tools: [{ ...prepared.tools[0], nativeName: 'memory_search' }],
    })).toThrow('mapping')
    expect(nativeToolName('alpha.beta-gamma')).toBe('dg_alpha__beta-gamma')
    expect(nativeToolName('alpha-beta.gamma')).toBe('dg_alpha-beta__gamma')
    expect(() => prepareCatalog('portable', snapshot(
      descriptor('memory.search', 'one'),
      descriptor('memory.search', 'two'),
    ))).toThrow('duplicate portable tool')
    expect(() => prepareCatalog('portable', snapshot({
      ...descriptor('memory.oversized'),
      description: 'x'.repeat(2 * 1024 * 1024),
    }))).toThrow('exceeds')
    expect(() => prepareCatalog('portable', snapshot(descriptor('memory.dynamic', 'one', {
      type: 'object',
      properties: { value: { $dynamicRef: '#node' } },
    })))).toThrow('$dynamicRef')
    expect(() => prepareCatalog('portable', snapshot(descriptor('memory.keyword-property', 'one', {
      type: 'object',
      properties: { $dynamicRef: { type: 'string' } },
    })))).not.toThrow()
    expect(() => prepareCatalog('portable', snapshot(descriptor('memory.scalar', 'one', {
      type: 'string',
    })))).toThrow('type must be "object"')
    expect(() => nativeToolName(`plugin.${'segment-'.repeat(10)}tool`)).toThrow('longer than 64')
    const accessor = Object.defineProperty({}, 'type', { enumerable: true, get: () => 'object' })
    expect(() => prepareCatalog('portable', snapshot(descriptor('memory.accessor', 'one', accessor)))).toThrow('accessor')
  })

  it('diagnoses undeclared tools without expanding the native model catalog', () => {
    const prepared = prepareCatalog('portable', snapshot(descriptor('memory.search')))
    const report = vi.fn()
    const projected = projectCatalog(prepared, snapshot(
      descriptor('memory.search', 'current-search'),
      descriptor('mcp-fixture.echo-value', 'current-mcp'),
    ), report)

    expect(projected.map(tool => [tool.nativeName, tool.descriptor.name])).toEqual([
      ['dg_memory__search', 'memory.search'],
    ])
    expect(report).toHaveBeenCalledWith(expect.stringContaining('mcp-fixture.echo-value'))
    expect(report).toHaveBeenCalledWith(expect.stringContaining('regenerate'))
    report.mockClear()
    projectCatalog(prepared, snapshot(descriptor(`plugin.${'a'.repeat(500)}`, 'long-current')), report)
    expect(String(report.mock.calls[0]?.[0]).length).toBeLessThan(512)
  })

  it('binds current declared descriptors only at a new native construction boundary', () => {
    const prepared = prepareCatalog('portable', snapshot(descriptor('memory.search', 'prepared-process')))
    const first = projectCatalog(prepared, snapshot(descriptor('memory.search', 'runtime-one')), () => undefined)
    const second = projectCatalog(prepared, snapshot(descriptor('memory.search', 'runtime-two')), () => undefined)

    expect(first[0]!.descriptor.revision).toBe('runtime-one')
    expect(second[0]!.descriptor.revision).toBe('runtime-two')
    expect(first[0]!.descriptor.revision).toBe('runtime-one')
  })

  it('rejects incompatible schema drift under an already declared name', () => {
    const prepared = prepareCatalog('portable', snapshot(descriptor('memory.search')))
    const report = vi.fn()
    expect(projectCatalog(prepared, snapshot(), report)).toEqual([])
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('unavailable'))

    report.mockClear()
    expect(projectCatalog(prepared, snapshot({ ...descriptor('memory.search'), available: false }), report)).toEqual([])
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('currently unavailable'))

    report.mockClear()
    expect(projectCatalog(prepared, snapshot(descriptor('memory.search', 'replacement', {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    })), report)).toEqual([])
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('no longer matches'))

    const twoPrepared = prepareCatalog('portable', snapshot(
      descriptor('memory.search'),
      descriptor('zeta.read'),
    ))
    report.mockClear()
    const contained = projectCatalog(twoPrepared, snapshot(
      descriptor('memory.search', 'unsupported-runtime', {
        type: 'object',
        properties: { query: { $dynamicRef: '#query' } },
      }),
      descriptor('zeta.read', 'healthy-runtime'),
    ), report)
    expect(contained.map(tool => tool.descriptor.name)).toEqual(['zeta.read'])
    expect(report).toHaveBeenCalledWith(expect.stringContaining('$dynamicRef'))
    expect(report).toHaveBeenCalledWith(expect.stringContaining('regenerate'))
  })
})
