import { describe, expect, it } from 'vitest'
import {
  NATIVE_OPENCLAW_SMOKE_TIMEOUT_MS,
  runNativeOpenClawSmoke,
} from './support/native-smoke-harness.ts'

describe('OpenClaw native integration smoke', () => {
  it(
    'runs the installed plugin through embedded context tools approval and shutdown',
    { timeout: NATIVE_OPENCLAW_SMOKE_TIMEOUT_MS },
    async () => {
      const result = await runNativeOpenClawSmoke()

      expect(result.openClawVersion).toBe('2026.9.1')
      expect(result.preparedToolNames).toEqual([
        'dg_fixture__approved',
        'dg_fixture__echo',
        'dg_mcp-smoke__smoke-echo',
      ])
      expect(result.approvalDecisions).toEqual(['allow-once', 'deny'])
      expect(result.markerEvents.some(event => event.event === 'turn-committed')).toBe(false)
      expect(result.gatewayLogs).not.toContain('reviewer-error')
    },
  )
})
