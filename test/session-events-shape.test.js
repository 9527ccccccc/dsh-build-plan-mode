import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILD_MODE,
  PLAN_MODE,
  PLAN_GUIDANCE,
  createPromptSection,
  createWorkflowConfiguration,
} from '../src/index.js'

// Regression: the 0.1.5 host Session exposes an immutable `snapshotEvents()`
// read over `log` and has NO public `events` array. A guard that required the
// old `events` array rejected every live 0.1.5 session with
// "build/plan mode needs a live agent session".
function liveSession(seed = []) {
  const log = seed.map((event, seq) => ({ ...event, seq }))
  return {
    id: 'session-live',
    log,
    inheritedEventCount: 0,
    snapshotEvents: () => Object.freeze([...log]),
    append(type, data) {
      const event = { type, data, seq: log.length }
      log.push(event)
      return event
    },
  }
}

// The pre-0.1.5 Session shape stays supported: a live `events` array.
function legacySession(seed = []) {
  const events = seed.map((event, seq) => ({ ...event, seq }))
  return {
    id: 'session-legacy',
    events,
    append(type, data) {
      const event = { type, data, seq: events.length }
      events.push(event)
      return event
    },
  }
}

for (const [shape, createSession] of [['0.1.5 snapshotEvents', liveSession], ['legacy events array', legacySession]]) {
  test(`a live ${shape} session selects, freezes, and reads modes`, async () => {
    const session = createSession()
    const authority = createWorkflowConfiguration()

    assert.deepEqual(authority.view(session), { revision: 0, next: BUILD_MODE, current: null })
    assert.deepEqual(await authority.selectMode({ session }, PLAN_MODE), {
      kind: 'changed', revision: 1, next: PLAN_MODE, applies: 'idle',
    })

    session.append('turn/start', { turn: 1 })
    assert.deepEqual(authority.view(session), {
      revision: 1, next: PLAN_MODE, current: { turn: 1, mode: PLAN_MODE },
    })
    assert.equal(createPromptSection(authority).text({ agent: { session } }), PLAN_GUIDANCE)

    assert.deepEqual(await authority.selectMode({ session }, BUILD_MODE), {
      kind: 'changed', revision: 2, next: BUILD_MODE, applies: 'next-turn',
    })
    // The frozen Current survives a mid-turn selection; Next carries the change.
    assert.deepEqual(authority.view(session), {
      revision: 2, next: BUILD_MODE, current: { turn: 1, mode: PLAN_MODE },
    })
  })
}

test('a value that is not a live session still reports the contract error', () => {
  const authority = createWorkflowConfiguration()
  const expected = { name: 'TypeError', message: 'build/plan mode needs a live agent session' }

  for (const candidate of [undefined, null, 'session-1', {}, { events: [] }, { snapshotEvents: () => [] }]) {
    assert.throws(() => authority.view(candidate), expected)
    // The guard runs before the operation is serialized, so the rejection is synchronous.
    assert.throws(() => authority.selectMode({ session: candidate }, PLAN_MODE), expected)
  }
})
