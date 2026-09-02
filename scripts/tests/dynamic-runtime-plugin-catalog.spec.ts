import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_SOURCE_PATHS,
  catalogSourceDigest,
  readCatalogSources,
} from '../../packages/extension-dynamic-runtime-plugins/scripts/catalog-source.mjs'
import { CATALOG_SOURCE_DIGEST } from '../../packages/extension-dynamic-runtime-plugins/src/catalog.generated.ts'

const repositoryRoot = resolve(import.meta.dirname, '../..')

describe('dynamic runtime plugin catalog freshness', () => {
  it('matches every selected public declaration in deterministic order', async () => {
    const declarations = await readCatalogSources(repositoryRoot)
    expect(catalogSourceDigest(declarations)).toBe(CATALOG_SOURCE_DIGEST)
    expect(CATALOG_SOURCE_PATHS).toEqual([...CATALOG_SOURCE_PATHS].sort())
  })

  it('changes the generated freshness identity when a selected declaration changes', async () => {
    const declarations = await readCatalogSources(repositoryRoot)
    const selected = CATALOG_SOURCE_PATHS[0]!
    const altered = await readCatalogSources(repositoryRoot, {
      [selected]: `${declarations[selected]}\n// simulated public declaration drift\n`,
    })
    expect(catalogSourceDigest(altered)).not.toBe(CATALOG_SOURCE_DIGEST)
    expect(await readFile(resolve(repositoryRoot, selected), 'utf8')).toBe(declarations[selected])
  })
})
