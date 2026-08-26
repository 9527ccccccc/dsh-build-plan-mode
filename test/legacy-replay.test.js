import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUILD_MODE,
  MODE_COMMAND,
  PLAN_MODE,
  STATE_COMMAND,
  foldModeState,
  modeView,
  reduceModeState,
} from '../src/index.js'

// Legacy replay lanes are permanent residents: the behavior spec requires
// reader-side compatibility for pre-v3 sessions, so their semantics are
// pinned here through the public fold interface only (spec R2-3, issue 14).
// A live Session can no longer produce these records; replay fixtures are
// the sanctioned compatibility case.

const NEXT_SELECTED = 'bplan/next-selected'
const TURN_FROZEN = 'bplan/turn-frozen'

const snapshotPair = (commandId, revision, mode) => [
  { type: 'command/run', data: { commandId, name: STATE_COMMAND, args: JSON.stringify({ v: 3, revision, next: { mode } }) } },
  { type: 'command/done', data: { commandId, kind: 'success' } },
]

test('bplan/next-selected commits the carried mode while revision is 0', () => {
  const state = foldModeState([{ type: NEXT_SELECTED, data: { mode: PLAN_MODE } }])
  assert.deepEqual(modeView(state), { revision: 0, next: PLAN_MODE, current: null })
})

test('bplan/next-selected for the already-current Next is an identical-state no-op', () => {
  const state = foldModeState([])
  const event = { type: NEXT_SELECTED, data: { mode: BUILD_MODE } }
  assert.equal(reduceModeState(state, event), state)
})

test('bplan/next-selected is ignored once a snapshot has advanced the revision', () => {
  const state = foldModeState([
    ...snapshotPair('c1', 1, PLAN_MODE),
    { type: NEXT_SELECTED, data: { mode: BUILD_MODE } },
  ])
  assert.deepEqual(modeView(state), { revision: 1, next: PLAN_MODE, current: null })
})

test('bplan/next-selected with a non-mode payload is ignored', () => {
  const state = foldModeState([])
  assert.equal(reduceModeState(state, { type: NEXT_SELECTED, data: { mode: 'chaos' } }), state)
})

test('bplan/turn-frozen freezes the carried turn into an absent Current', () => {
  const state = foldModeState([{ type: TURN_FROZEN, data: { turn: 7, mode: PLAN_MODE } }])
  assert.deepEqual(modeView(state), { revision: 0, next: BUILD_MODE, current: { turn: 7, mode: PLAN_MODE } })
})

test('bplan/turn-frozen never overwrites an open Current', () => {
  const state = foldModeState([
    { type: 'turn/start', data: { turn: 5 } },
    { type: TURN_FROZEN, data: { turn: 9, mode: PLAN_MODE } },
  ])
  assert.deepEqual(modeView(state).current, { turn: 5, mode: BUILD_MODE })
})

test('bplan/turn-frozen ignores non-integer turns and non-mode payloads', () => {
  const state = foldModeState([])
  assert.equal(reduceModeState(state, { type: TURN_FROZEN, data: { turn: 'seven', mode: PLAN_MODE } }), state)
  assert.equal(reduceModeState(state, { type: TURN_FROZEN, data: { turn: 7, mode: 'chaos' } }), state)
})

test('a revision-0 first-carrier bplan command commits its normalized argument on success', () => {
  const state = foldModeState([
    { type: 'command/run', data: { commandId: 'k1', name: MODE_COMMAND, args: '  PLAN  ' } },
    { type: 'command/done', data: { commandId: 'k1', kind: 'success' } },
  ])
  assert.deepEqual(modeView(state), { revision: 0, next: PLAN_MODE, current: null })
})

test('a failed first-carrier command commits nothing; a repeated same-mode pair stays put', () => {
  const failed = foldModeState([
    { type: 'command/run', data: { commandId: 'k1', name: MODE_COMMAND, args: 'plan' } },
    { type: 'command/done', data: { commandId: 'k1', kind: 'error' } },
  ])
  assert.deepEqual(modeView(failed), { revision: 0, next: BUILD_MODE, current: null })

  // An accepted command/run registers its pending entry (a fresh state
  // object); whether the carried mode commits is decided at command/done.
  const committed = foldModeState([
    { type: 'command/run', data: { commandId: 'k1', name: MODE_COMMAND, args: 'plan' } },
    { type: 'command/done', data: { commandId: 'k1', kind: 'success' } },
    { type: 'command/run', data: { commandId: 'k2', name: MODE_COMMAND, args: 'plan' } },
    { type: 'command/done', data: { commandId: 'k2', kind: 'success' } },
  ])
  assert.deepEqual(modeView(committed), { revision: 0, next: PLAN_MODE, current: null })
})

test('a higher-revision v3 snapshot beats legacy lanes in either arrival order', () => {
  const legacyFirst = foldModeState([
    { type: NEXT_SELECTED, data: { mode: PLAN_MODE } },
    ...snapshotPair('c1', 1, BUILD_MODE),
  ])
  assert.deepEqual(modeView(legacyFirst), { revision: 1, next: BUILD_MODE, current: null })

  const snapshotFirst = foldModeState([
    ...snapshotPair('c1', 1, BUILD_MODE),
    { type: NEXT_SELECTED, data: { mode: PLAN_MODE } },
  ])
  assert.deepEqual(modeView(snapshotFirst), { revision: 1, next: BUILD_MODE, current: null })
})
