import { describe, expect, it } from 'vitest'
import {
  applyMutation,
  createProposal,
  EvolutionError,
  rejectProposal,
  resumeProposal,
  snoozeProposal,
  transitionProposal,
  type EvolutionMutationContext,
} from '../src/model.ts'

function context(now = '2026-09-02T12:00:00.000Z'): EvolutionMutationContext {
  let ordinal = 0
  return Object.freeze({
    instanceId: 'mark',
    actorId: 'valera',
    projectId: 'project-a',
    now,
    id: () => `id-${++ordinal}`,
  })
}

function capability(scope: 'global' | 'project' = 'global') {
  return createProposal({
    operationId: 'propose-1',
    kind: 'capability',
    scope,
    dedupeKey: 'capability.semantic-search',
    title: 'Add semantic search',
    rationale: 'Repeated investigations need reusable semantic retrieval.',
    tags: ['search', 'semantic'],
    evidence: [{ summary: 'The same retrieval gap occurred twice.', sourceId: 'turn:one' }],
  }, context())
}

describe('Evolution proposal contracts', () => {
  it('creates deeply frozen bounded proposals and rejects invalid kind/scope and credentials', () => {
    const proposal = capability()
    expect(proposal).toMatchObject({ kind: 'capability', scope: 'global', status: 'proposed', revision: 1 })
    expect(Object.isFrozen(proposal)).toBe(true)
    expect(Object.isFrozen(proposal.evidence)).toBe(true)
    expect(Object.isFrozen(proposal.evidence[0])).toBe(true)
    expect(() => createProposal({
      operationId: 'persona-project', kind: 'persona', scope: 'project', dedupeKey: 'persona.tone',
      title: 'Refine tone', rationale: 'Stable tone opportunity.',
    }, context())).toThrowError(expect.objectContaining({ code: 'INVALID_SCOPE' }))
    expect(() => createProposal({
      operationId: 'secret', kind: 'capability', scope: 'global', dedupeKey: 'capability.secret',
      title: 'Store api_key = abcdefghijklmnop', rationale: 'Unsafe.',
    }, context())).toThrowError(expect.objectContaining({ code: 'CREDENTIAL_REJECTED' }))
    expect(() => createProposal({
      operationId: 'bad-key', kind: 'capability', scope: 'global', dedupeKey: 'Not a semantic key!',
      title: 'Title', rationale: 'Rationale',
    }, context())).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })

  it('enforces capability and Persona state matrices, exact revisions, and terminal outcomes', () => {
    let proposal = capability()
    expect(() => transitionProposal(proposal, {
      operationId: 'skip', id: proposal.id, expectedRevision: 1, target: 'planned', planReference: 'plan:one',
    }, context())).toThrowError(expect.objectContaining({ code: 'INVALID_TRANSITION' }))
    proposal = transitionProposal(proposal, {
      operationId: 'research', id: proposal.id, expectedRevision: 1,
      target: 'researching', researchQuestion: 'Which maintained implementation fits?',
    }, context())
    expect(proposal).toMatchObject({ status: 'researching', revision: 2 })
    expect(() => transitionProposal(proposal, {
      operationId: 'stale', id: proposal.id, expectedRevision: 1,
      target: 'options-ready', optionsSummary: 'Options.', sourceIds: ['source:one'],
    }, context())).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }))
    proposal = transitionProposal(proposal, {
      operationId: 'options', id: proposal.id, expectedRevision: 2,
      target: 'options-ready', optionsSummary: 'Two source-verified options.', sourceIds: ['source:one'],
    }, context())
    proposal = transitionProposal(proposal, {
      operationId: 'selected', id: proposal.id, expectedRevision: 3,
      target: 'selected', selectedOption: 'Use the portable package.',
    }, context())
    proposal = transitionProposal(proposal, {
      operationId: 'planned', id: proposal.id, expectedRevision: 4,
      target: 'planned', planReference: 'openspec:add-search',
    }, context())
    proposal = transitionProposal(proposal, {
      operationId: 'implementing', id: proposal.id, expectedRevision: 5,
      target: 'implementing', implementationReference: 'change:add-search',
    }, context())
    proposal = transitionProposal(proposal, {
      operationId: 'done', id: proposal.id, expectedRevision: 6,
      target: 'done', outcome: 'Verified in the active Runtime Preset.',
    }, context())
    expect(proposal).toMatchObject({ status: 'done', revision: 7 })
    expect(() => rejectProposal(proposal, {
      operationId: 'reject-done', id: proposal.id, expectedRevision: 7, reason: 'No.',
    }, context())).toThrowError(expect.objectContaining({ code: 'TERMINAL_PROPOSAL' }))

    let persona = createProposal({
      operationId: 'persona', kind: 'persona', scope: 'global', dedupeKey: 'persona.directness',
      title: 'Refine directness', rationale: 'Several sessions support a more direct collaboration style.',
    }, context())
    persona = transitionProposal(persona, {
      operationId: 'review', id: persona.id, expectedRevision: 1,
      target: 'reviewing', reviewSummary: 'User explicitly selected review.',
    }, context())
    expect(persona.status).toBe('reviewing')
    expect(() => transitionProposal(persona, {
      operationId: 'wrong', id: persona.id, expectedRevision: 2,
      target: 'researching', researchQuestion: 'Wrong path.',
    }, context())).toThrowError(expect.objectContaining({ code: 'INVALID_TRANSITION' }))
  })

  it('restores the prior forward state after snooze and keeps rejection terminal', () => {
    const proposal = transitionProposal(capability(), {
      operationId: 'research', id: 'id-1', expectedRevision: 1,
      target: 'researching', researchQuestion: 'Research after consent.',
    }, context())
    const snoozed = snoozeProposal(proposal, {
      operationId: 'snooze', id: proposal.id, expectedRevision: 2,
      until: '2026-09-10T12:00:00.000Z', reason: 'Return after the release.',
    }, context())
    expect(snoozed).toMatchObject({ status: 'snoozed', resumeStatus: 'researching', revision: 3 })
    expect(() => resumeProposal(snoozed, {
      operationId: 'early', id: snoozed.id, expectedRevision: 3,
    }, context('2026-09-09T12:00:00.000Z'))).toThrowError(expect.objectContaining({ code: 'SNOOZE_ACTIVE' }))
    const resumed = resumeProposal(snoozed, {
      operationId: 'resume', id: snoozed.id, expectedRevision: 3,
    }, context('2026-09-10T12:00:00.000Z'))
    expect(resumed).toMatchObject({ status: 'researching', revision: 4 })
    expect(resumed).not.toHaveProperty('snoozedUntil')
    expect(resumed).not.toHaveProperty('resumeStatus')
    const rejected = rejectProposal(resumed, {
      operationId: 'reject', id: resumed.id, expectedRevision: 4, reason: 'User declined the opportunity.',
    }, context())
    expect(rejected.status).toBe('rejected')
    expect(() => resumeProposal(rejected, {
      operationId: 'reopen', id: rejected.id, expectedRevision: 5,
    }, context())).toThrowError(EvolutionError)
  })

  it('deduplicates active keys with distinct evidence and conflicts on terminal keys', () => {
    const first = capability()
    const updated = applyMutation([first], {
      kind: 'propose',
      request: {
        operationId: 'second', kind: 'capability', scope: 'global', dedupeKey: first.dedupeKey,
        title: first.title, rationale: first.rationale,
        evidence: [{ summary: 'A third occurrence confirmed the gap.', sourceId: 'turn:three' }],
      },
    }, context())
    expect(updated.id).toBe(first.id)
    expect(updated.revision).toBe(2)
    expect(updated.evidence).toHaveLength(2)
    const rejected = rejectProposal(updated, {
      operationId: 'reject', id: updated.id, expectedRevision: 2, reason: 'Not useful.',
    }, context())
    expect(() => applyMutation([rejected], {
      kind: 'propose',
      request: {
        operationId: 'third', kind: 'capability', scope: 'global', dedupeKey: first.dedupeKey,
        title: first.title, rationale: first.rationale,
      },
    }, context())).toThrowError(expect.objectContaining({ code: 'DEDUPE_TERMINAL' }))
  })
})
