import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  createOmpHostEventPlugin,
  defineOmpTodoReminderEvent,
  OMP_HOST_EVENT_PROTOCOL_VERSION,
  type OmpHostEventSink,
} from '../src/omp-host-events.ts'

function reminder() {
  return {
    protocolVersion: OMP_HOST_EVENT_PROTOCOL_VERSION,
    type: 'todo-reminder' as const,
    deliveryId: 'session-one:todo-reminder:1',
    sessionId: 'session-one',
    timestamp: 1,
    todos: [
      { content: 'Finish protocol cutover', status: 'in_progress' as const },
      { content: 'Wait for upstream', status: 'blocked' as const, blocker: 'upstream release' },
    ],
    attempt: 1,
    maxAttempts: 3,
  }
}

async function hostEventContext(sessionId: string): Promise<Context> {
  const root = new Context()
  await root.plugin({
    name: `runtime-session-${sessionId}`,
    apply(ctx) {
      ctx.provide('doppelgangerRuntimeSession', Object.freeze({
        sessionId,
        runtimePresetId: 'host-event-test',
      }))
    },
  })
  return root
}

describe('OMP host events', () => {
  it('validates, freezes, publishes, and detaches typed todo reminders', async () => {
    const root = await hostEventContext('session-one')
    const observed = vi.fn()
    root.on('doppelganger/host/omp/todo-reminder', observed)
    let sink: OmpHostEventSink | undefined
    const owner = await root.plugin(createOmpHostEventPlugin({
      attach(value) { sink = value },
      detach(value) { if (sink === value) sink = undefined },
    }))

    const active = sink
    if (active === undefined) throw new Error('OMP host event sink did not attach')
    await active.publishTodoReminder(reminder())
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({
      type: 'todo-reminder',
      sessionId: 'session-one',
      todos: [
        { content: 'Finish protocol cutover', status: 'in_progress' },
        { content: 'Wait for upstream', status: 'blocked', blocker: 'upstream release' },
      ],
    }))
    const event = observed.mock.calls[0]?.[0]
    expect(Object.isFrozen(event)).toBe(true)
    expect(Object.isFrozen(event.todos)).toBe(true)

    await owner.dispose()
    expect(sink).toBeUndefined()
    await expect(active.publishTodoReminder(reminder())).rejects.toThrow('detached')
    await root.fiber.dispose()
  })

  it('isolates reminders by owning Runtime Session', async () => {
    const first = await hostEventContext('session-one')
    const second = await hostEventContext('session-two')
    const firstObserved = vi.fn()
    const secondObserved = vi.fn()
    first.on('doppelganger/host/omp/todo-reminder', firstObserved)
    second.on('doppelganger/host/omp/todo-reminder', secondObserved)
    let firstSink: OmpHostEventSink | undefined
    let secondSink: OmpHostEventSink | undefined
    await first.plugin(createOmpHostEventPlugin({
      attach(value) { firstSink = value },
      detach(value) { if (firstSink === value) firstSink = undefined },
    }))
    await second.plugin(createOmpHostEventPlugin({
      attach(value) { secondSink = value },
      detach(value) { if (secondSink === value) secondSink = undefined },
    }))

    if (firstSink === undefined || secondSink === undefined) throw new Error('OMP host event sinks did not attach')
    await firstSink.publishTodoReminder(reminder())
    expect(firstObserved).toHaveBeenCalledOnce()
    expect(secondObserved).not.toHaveBeenCalled()
    await expect(secondSink.publishTodoReminder(reminder())).rejects.toThrow('does not match Runtime Session "session-two"')
    expect(secondObserved).not.toHaveBeenCalled()

    await Promise.all([first.fiber.dispose(), second.fiber.dispose()])
  })

  it('rejects malformed, oversized, and unsupported reminder envelopes', () => {
    expect(() => defineOmpTodoReminderEvent({ ...reminder(), protocolVersion: 2 }))
      .toThrow('unsupported OMP host event protocol version 2')
    expect(() => defineOmpTodoReminderEvent({ ...reminder(), extra: true }))
      .toThrow('unsupported fields: extra')
    expect(() => defineOmpTodoReminderEvent({
      ...reminder(),
      todos: [{ content: 'invalid', status: 'unknown' }],
    })).toThrow('status is unsupported')
    expect(() => defineOmpTodoReminderEvent({ ...reminder(), attempt: 4, maxAttempts: 3 }))
      .toThrow('attempt must not exceed maxAttempts')
    expect(() => defineOmpTodoReminderEvent({ ...reminder(), todos: Array.from({ length: 257 }, () => ({
      content: 'bounded', status: 'pending',
    })) })).toThrow('at most 256 entries')
  })
})
