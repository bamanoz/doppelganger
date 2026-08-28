import type { Context, Plugin } from '@deepseek-ai/cordis'
import {
  publishLifecycleEvent,
  type LifecycleDiagnostic,
  type LifecycleEvent,
} from '../../src/index.ts'

export interface FakeLifecycleHost {
  readonly plugin: Plugin
  readonly diagnostics: readonly LifecycleDiagnostic[]
  publish(event: LifecycleEvent): Promise<void>
}

export function createFakeLifecycleHost(): FakeLifecycleHost {
  let context: Context | undefined
  const diagnostics: LifecycleDiagnostic[] = []
  const active = () => {
    if (context === undefined) throw new Error('fake lifecycle host is not active')
    return context
  }
  return {
    plugin: {
      name: 'fake-lifecycle-host',
      apply(ctx) {
        context = ctx
        return () => { context = undefined }
      },
    },
    diagnostics,
    publish: event => publishLifecycleEvent(active(), event, {
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    }),
  }
}
