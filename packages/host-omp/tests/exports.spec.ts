import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  createDoppelgangerOmpExtension,
  type DoppelgangerOmpExtensionOptions,
  type OmpChildConnection,
  type OmpChildDisposal,
  type OmpChildFactory,
} from '@doppelganger/doppelganger-host-omp'
import * as hostOmp from '@doppelganger/doppelganger-host-omp'

const require = createRequire(import.meta.url)

function acceptsRootContracts(
  _options: DoppelgangerOmpExtensionOptions,
  _connection: OmpChildConnection,
  _disposal: OmpChildDisposal,
  _factory: OmpChildFactory,
): void {}

void acceptsRootContracts

describe('host-omp package exports', () => {
  it('exposes only the ordinary extension constructor at runtime', () => {
    expect(Object.keys(hostOmp)).toEqual(['createDoppelgangerOmpExtension'])
    expect(hostOmp.createDoppelgangerOmpExtension).toBe(createDoppelgangerOmpExtension)
  })

  it('does not expose package-private transport or child modules', () => {
    expect(() => require.resolve('@doppelganger/doppelganger-host-omp/protocol'))
      .toThrow(/package subpath|exports/i)
    expect(() => require.resolve('@doppelganger/doppelganger-host-omp/child'))
      .toThrow(/package subpath|exports/i)
  })
})
