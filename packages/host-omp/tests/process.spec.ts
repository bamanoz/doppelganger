import { describe, expect, it } from 'vitest'
import { defaultNodePath } from '../src/process.ts'

describe('Node OMP child process selection', () => {
  it('does not recursively spawn a non-Node host executable', () => {
    expect(defaultNodePath('C:\\Users\\example\\AppData\\Local\\omp\\omp.exe')).toBe('node')
    expect(defaultNodePath('/opt/omp/bin/omp')).toBe('node')
  })

  it('preserves an actual Node executable path', () => {
    expect(defaultNodePath('C:\\Program Files\\nodejs\\node.exe')).toBe('C:\\Program Files\\nodejs\\node.exe')
    expect(defaultNodePath('/opt/node/bin/node')).toBe('/opt/node/bin/node')
  })
})
