import type { Context } from '@deepseek-ai/cordis'
import {
  digestToolInput,
  type JsonValue,
  type ToolInvocationResult,
} from '@doppelganger/doppelganger-protocols'

export function invokeTool(
  ctx: Context,
  name: string,
  input: JsonValue,
  sessionId = 'test-session',
): Promise<ToolInvocationResult> {
  const descriptor = ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === name)
  if (descriptor === undefined) {
    return ctx.doppelgangerTools.invoke({
      callId: crypto.randomUUID(),
      name,
      toolRevision: 'tool:missing',
      input,
    }, sessionId)
  }
  const callId = crypto.randomUUID()
  return ctx.doppelgangerTools.invoke({
    callId,
    name,
    toolRevision: descriptor.revision,
    input,
    ...(descriptor.approval === undefined ? {} : {
      approval: {
        kind: 'one-shot',
        grantId: crypto.randomUUID(),
        callId,
        toolRevision: descriptor.revision,
        inputDigest: digestToolInput(input),
      },
    }),
  }, sessionId)
}
