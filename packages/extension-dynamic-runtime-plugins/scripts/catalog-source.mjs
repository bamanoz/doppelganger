import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const CATALOG_SOURCE_PATHS = Object.freeze([
  'node_modules/@deepseek-ai/cordis-plugin-timer/src/index.ts',
  'packages/extension-dynamic-runtime-plugins/src/catalog-contracts.ts',
  'packages/extension-protocols/src/context.ts',
  'packages/extension-protocols/src/lifecycle.ts',
  'packages/extension-protocols/src/tools.ts',
])

export async function readCatalogSources(repositoryRoot, overrides = {}) {
  return Object.fromEntries(await Promise.all(CATALOG_SOURCE_PATHS.map(async source => [
    source,
    Object.prototype.hasOwnProperty.call(overrides, source)
      ? overrides[source]
      : await readFile(resolve(repositoryRoot, source), 'utf8'),
  ])))
}

export function catalogSourceDigest(declarations) {
  const digest = createHash('sha256')
  for (const source of CATALOG_SOURCE_PATHS) {
    const declaration = declarations[source]
    if (typeof declaration !== 'string') throw new TypeError(`missing catalog source ${source}`)
    digest.update(source).update('\0').update(declaration).update('\0')
  }
  return `sha256:${digest.digest('hex')}`
}
