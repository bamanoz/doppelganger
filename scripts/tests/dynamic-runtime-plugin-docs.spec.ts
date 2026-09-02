import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const paths = [
  'docs/features/dynamic-runtime-plugins.md',
  'docs/hosts/oh-my-pi.md',
  'docs/hosts/deepseek-harness.md',
  'docs/operations/configuration.md',
  'docs/project/status-and-scope.md',
  'README.md',
]

describe('Dynamic Runtime Plugins documentation', () => {
  it('states the generated-code trust boundary without sandbox claims', async () => {
    const documents = await Promise.all(paths.map(async path => [path, await readFile(resolve(path), 'utf8')] as const))
    const feature = documents.find(([path]) => path === 'docs/features/dynamic-runtime-plugins.md')?.[1] ?? ''

    expect(feature).toContain('trusted-code workflow')
    expect(feature).toContain('not a security sandbox')
    expect(feature).toContain('authority comparable to shell access')
    expect(feature).toContain('failure boundary, not hostile-code containment')
    expect(feature).toContain('same-process trusted code under DSH')
    expect(feature).toContain('They are not persisted')
    expect(feature).toContain('shipped `standard`')

    for (const [path, content] of documents) {
      expect(content, path).not.toMatch(/\bis (?:a )?(?:secure|security) sandbox\b/iu)
    }
  })
})
