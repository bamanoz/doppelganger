import { describe, it } from 'vitest'
import {
  checkExactNativeApprovalAndReplay,
  checkFixedCapabilitiesActorStatesAndLifecycleBoundary,
  checkNativeCancellationCompletionAndDisposal,
  checkNativeRegistrationIsolationAndOptionalProtocols,
  checkPortableSnapshotAndFixedNativeProjection,
} from './support/conformance-cases.ts'

describe('OpenClaw Runtime Host conformance', () => {
  it('passes common semantics through the real fixed-catalog OpenClaw adapter', async () => {
    await checkNativeRegistrationIsolationAndOptionalProtocols()
    await checkPortableSnapshotAndFixedNativeProjection()
    await checkExactNativeApprovalAndReplay()
    await checkNativeCancellationCompletionAndDisposal()
    await checkFixedCapabilitiesActorStatesAndLifecycleBoundary()
  })
})
