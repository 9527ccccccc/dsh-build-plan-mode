import assert from 'node:assert/strict'
import test from 'node:test'
import plugin, {
  BUILD_MODE,
  MODE_PROJECTION_KEY,
  NEXT_SELECTED_EVENT,
  PLAN_GUIDANCE,
  PLAN_MODE,
  PLAN_POLICY_DENIAL,
  STATE_COMMAND,
  TURN_FROZEN_EVENT,
  createModeCommand,
  createModeProjectionDefinition,
  createPromptSection,
  createSelectionOperation,
  createToolGuard,
  createWorkflowConfiguration,
  foldModeState,
  initialModeState,
  installModeProjection,
  installPromptAdapter,
  installToolPolicyAdapter,
  modeView,
  policyFor,
  reduceModeState,
} from '../src/index.js'
import { CHILD_CREATING_TOOLS, CHILD_NEVER_TOOLS, PLAN_OBSERVATION_TOOLS } from '../src/tool-taxonomy.js'

// The continuable-child creation pair follows its own argument rule
// (background-only), so it sits outside every parent denial sweep below.
const PARENT_DENIED_TOOLS = CHILD_NEVER_TOOLS.filter((name) => !CHILD_CREATING_TOOLS.includes(name))

function createSession(id = 'session-1', seed = []) {
  const events = seed.map((event, seq) => ({ ...event, seq }))
  return {
    id,
    events,
    append(type, data) {
      const event = { type, data, seq: events.length }
      events.push(event)
      return event
    },
  }
}

function freezeTurn(session, turn) {
  session.append('turn/start', { turn })
}

function endTurn(session, turn, kind = 'completed') {
  session.append('turn/end', { turn, reason: { kind } })
}

function appendStateSnapshot(session, snapshot) {
  const commandId = `test-bplan-state-${snapshot.revision}`
  session.append('command/run', { commandId, name: 'bplan-state', args: JSON.stringify(snapshot), source: { kind: 'user' } })
  session.append('command/done', { commandId, kind: 'success' })
}

test('empty history defaults to Build, revision zero, and null Current', () => {
  const state = initialModeState()
  assert.deepEqual(state, { schema: 3, revision: 0, next: BUILD_MODE, current: null, pendingSnapshots: {} })
  assert.deepEqual(modeView(state), { revision: 0, next: BUILD_MODE, current: null })
  assert.equal(reduceModeState(state, { type: 'user/message', data: {} }), state)
})

test('select, freeze, mid-turn select, end, and next freeze preserve frozen Current', async () => {
  const session = createSession()
  const agent = { session }
  const authority = createWorkflowConfiguration()

  assert.deepEqual(await authority.selectMode(agent, PLAN_MODE), { kind: 'changed', revision: 1, next: PLAN_MODE, applies: 'idle' })
  freezeTurn(session, 1)
  assert.deepEqual(authority.view(session), { revision: 1, next: PLAN_MODE, current: { turn: 1, mode: PLAN_MODE } })
  assert.deepEqual(await authority.selectMode(agent, BUILD_MODE), { kind: 'changed', revision: 2, next: BUILD_MODE, applies: 'next-turn' })
  assert.deepEqual(authority.view(session), { revision: 2, next: BUILD_MODE, current: { turn: 1, mode: PLAN_MODE } })

  endTurn(session, 1)
  assert.deepEqual(authority.view(session), { revision: 2, next: BUILD_MODE, current: null })
  freezeTurn(session, 2)
  assert.deepEqual(authority.view(session), { revision: 2, next: BUILD_MODE, current: { turn: 2, mode: BUILD_MODE } })
})

test('duplicate native turn starts are idempotent and cannot refreeze an open turn', async () => {
  const session = createSession()
  const agent = { session }
  const authority = createWorkflowConfiguration()
  await authority.selectMode(agent, PLAN_MODE)
  freezeTurn(session, 3)
  const eventCount = session.events.length

  freezeTurn(session, 3)
  freezeTurn(session, 4)
  assert.deepEqual(authority.view(session), { revision: 1, next: PLAN_MODE, current: { turn: 3, mode: PLAN_MODE } })
  assert.equal(session.events.length, eventCount + 2)
})

test('turn end clears only its matching Current without changing Next', async () => {
  for (const kind of ['completed', 'error', 'aborted', 'disposed', 'blocked']) {
    const session = createSession(`${kind}-session`)
    const agent = { session }
    const authority = createWorkflowConfiguration()
    await authority.selectMode(agent, PLAN_MODE)
    freezeTurn(session, 1)
    endTurn(session, 0, kind)
    assert.deepEqual(authority.view(session), { revision: 1, next: PLAN_MODE, current: { turn: 1, mode: PLAN_MODE } })
    endTurn(session, 1, kind)
    assert.deepEqual(authority.view(session), { revision: 1, next: PLAN_MODE, current: null })
  }
})

test('event replay reproduces the authoritative state and supports resume', async () => {
  const session = createSession()
  const authority = createWorkflowConfiguration()
  const agent = { session }
  await authority.selectMode(agent, PLAN_MODE)
  freezeTurn(session, 1)
  await authority.selectMode(agent, BUILD_MODE)
  endTurn(session, 1)
  freezeTurn(session, 2)

  const replayed = foldModeState(session.events)
  assert.deepEqual(modeView(replayed), authority.view(session))

  const resumed = createSession('resumed', session.events)
  assert.deepEqual(createWorkflowConfiguration().view(resumed), {
    revision: 2,
    next: BUILD_MODE,
    current: { turn: 2, mode: BUILD_MODE },
  })
})

test('sessions from different Agent presets retain independent Next and Current modes', async () => {
  const first = { ...createSession('first'), meta: { agentPreset: 'minimal' } }
  const second = { ...createSession('second'), meta: { agentPreset: 'creative' } }
  const authority = createWorkflowConfiguration()

  await authority.selectMode({ session: first }, PLAN_MODE)
  freezeTurn(first, 1)
  freezeTurn(second, 1)

  assert.deepEqual(authority.view(first), { revision: 1, next: PLAN_MODE, current: { turn: 1, mode: PLAN_MODE } })
  assert.deepEqual(authority.view(second), { revision: 0, next: BUILD_MODE, current: { turn: 1, mode: BUILD_MODE } })
})

test('concurrent selections serialize per Session while separate Sessions advance independently', async () => {
  const first = createSession('first-queue')
  const second = createSession('second-queue')
  const workflow = createWorkflowConfiguration()

  const [firstPlan, firstBuild, secondPlan] = await Promise.all([
    workflow.selectMode({ session: first }, PLAN_MODE),
    workflow.selectMode({ session: first }, BUILD_MODE),
    workflow.selectMode({ session: second }, PLAN_MODE),
  ])

  assert.deepEqual(firstPlan, { kind: 'changed', revision: 1, next: PLAN_MODE, applies: 'idle' })
  assert.deepEqual(firstBuild, { kind: 'changed', revision: 2, next: BUILD_MODE, applies: 'idle' })
  assert.deepEqual(secondPlan, { kind: 'changed', revision: 1, next: PLAN_MODE, applies: 'idle' })
  assert.deepEqual(workflow.view(first), { revision: 2, next: BUILD_MODE, current: null })
  assert.deepEqual(workflow.view(second), { revision: 1, next: PLAN_MODE, current: null })
})

test('fork cuts inherit accepted state then parent and child diverge independently', async () => {
  const parent = createSession('parent')
  const workflow = createWorkflowConfiguration()
  await workflow.selectMode({ session: parent }, PLAN_MODE)
  const child = createSession('child', parent.events)

  await workflow.selectMode({ session: parent }, BUILD_MODE)
  assert.deepEqual(workflow.view(child), { revision: 1, next: PLAN_MODE, current: null })
  await workflow.selectMode({ session: child }, BUILD_MODE)
  await workflow.selectMode({ session: child }, PLAN_MODE)

  assert.deepEqual(workflow.view(parent), { revision: 2, next: BUILD_MODE, current: null })
  assert.deepEqual(workflow.view(child), { revision: 3, next: PLAN_MODE, current: null })
})

test('selectMode is the shared operation, noops without append, and append failure does not commit', async () => {
  const session = createSession()
  const agent = { session }
  const authority = createWorkflowConfiguration()
  assert.deepEqual(await authority.selectMode(agent, BUILD_MODE), {
    kind: 'noop', revision: 0, next: BUILD_MODE, applies: 'idle',
  })
  assert.equal(session.events.length, 0)
  assert.throws(() => authority.selectMode(agent, 'other'), /invalid build\/plan mode/)

  const failure = new Error('append failed verbatim')
  const failing = createWorkflowConfiguration({ appendSnapshot() { throw failure } })
  await assert.rejects(failing.selectMode(agent, PLAN_MODE), failure)
  assert.deepEqual(failing.view(session), { revision: 0, next: BUILD_MODE, current: null })

  const partial = createSession('partial')
  let appendCalls = 0
  partial.append = (type, data) => {
    appendCalls += 1
    if (appendCalls === 2) throw failure
    const event = { type, data, seq: partial.events.length }
    partial.events.push(event)
    return event
  }
  const partialWorkflow = createWorkflowConfiguration()
  await assert.rejects(partialWorkflow.selectMode({ session: partial }, PLAN_MODE), failure)
  assert.deepEqual(partialWorkflow.view(partial), { revision: 0, next: BUILD_MODE, current: null })
})

test('state events carry the minimal designed payloads for replay', async () => {
  const session = createSession()
  const authority = createWorkflowConfiguration()
  const agent = { session }
  await authority.selectMode(agent, PLAN_MODE)
  freezeTurn(session, 7)
  await authority.selectMode(agent, BUILD_MODE)

  assert.deepEqual(session.events.map(({ type }) => type), [
    'command/run', 'command/done', 'turn/start', 'command/run', 'command/done',
  ])
  const runs = session.events.filter(({ type }) => type === NEXT_SELECTED_EVENT)
  assert.deepEqual(runs.map(({ data }) => ({
    name: data.name,
    snapshot: JSON.parse(data.args),
  })), [
    { name: 'bplan-state', snapshot: { v: 3, revision: 1, next: { mode: PLAN_MODE } } },
    { name: 'bplan-state', snapshot: { v: 3, revision: 2, next: { mode: BUILD_MODE } } },
  ])
  assert.equal(runs[0].data.args, '{"v":3,"revision":1,"next":{"mode":"plan"}}')
  assert.equal(runs[1].data.args, '{"v":3,"revision":2,"next":{"mode":"build"}}')
  assert.deepEqual(session.events.find(({ type }) => type === TURN_FROZEN_EVENT).data, { turn: 7 })
  assert.equal(session.events.some(({ type }) => type.startsWith('bplan/')), false)
  assert.equal(MODE_PROJECTION_KEY, 'bplanMode')
})

test('projection definition follows the rc2 stateSchema/wire contract with stateVersion 3', () => {
  const definition = createModeProjectionDefinition()
  assert.equal(definition.key, MODE_PROJECTION_KEY)
  assert.equal(definition.stateVersion, 3)
  assert.equal(definition.schema, undefined)
  assert.equal(definition.view, undefined)
  assert.equal(typeof definition.stateSchema.parse, 'function')
  assert.equal(typeof definition.wire.viewSchema.parse, 'function')
  assert.equal(typeof definition.wire.view, 'function')
  assert.deepEqual(definition.wire.view(definition.init()), { revision: 0, next: BUILD_MODE, current: null })
  assert.deepEqual(
    definition.stateSchema.parse({ schema: 3, revision: 1, next: PLAN_MODE, current: null, pendingSnapshots: {} }),
    { schema: 3, revision: 1, next: PLAN_MODE, current: null, pendingSnapshots: {} },
  )
  assert.throws(() => definition.stateSchema.parse({ revision: 0, next: 'other', current: null }), /invalid build\/plan next mode/)
  assert.throws(() => definition.stateSchema.parse({ revision: -1, next: BUILD_MODE, current: null }), /invalid build\/plan revision/)
  assert.throws(() => definition.wire.viewSchema.parse({ revision: 0, next: 'other', current: null }), /invalid build\/plan next mode/)
})

test('projection registration folds native turn start and disposes exactly once', async () => {
  const session = createSession()
  const authority = createWorkflowConfiguration()
  const calls = []
  const ctx = {
    sessionProjections: {
      register(definition) {
        calls.push(['register', definition.key, definition.stateVersion])
        return () => calls.push('projection disposed')
      },
    },
  }
  const dispose = installModeProjection(ctx)
  await authority.selectMode({ session }, PLAN_MODE)
  freezeTurn(session, 1)
  assert.deepEqual(authority.view(session), { revision: 1, next: PLAN_MODE, current: { turn: 1, mode: PLAN_MODE } })
  dispose()
  assert.deepEqual(calls, [
    ['register', MODE_PROJECTION_KEY, 3],
    'projection disposed',
  ])
})

test('legacy v2 snapshots replay into Core mode without exposing model fields', () => {
  const session = createSession()
  appendStateSnapshot(session, {
    v: 2,
    revision: 1,
    next: { mode: PLAN_MODE, build: { provider: 'provider-a', model: 'legacy' }, plan: { provider: 'provider-a', model: 'legacy' } },
  })
  const state = foldModeState(session.events)
  assert.deepEqual(modeView(state), { revision: 1, next: PLAN_MODE, current: null })
  assert.equal(state.build, undefined)
  assert.equal(state.plan, undefined)
})

test('failed, incomplete, malformed, unsupported, and older snapshots do not change authoritative state', () => {
  const session = createSession('invalid-snapshots')
  session.append('command/run', { commandId: 'failed', name: STATE_COMMAND, args: JSON.stringify({ v: 3, revision: 1, next: { mode: PLAN_MODE } }), source: { kind: 'user' } })
  session.append('command/done', { commandId: 'failed', kind: 'error' })
  session.append('command/run', { commandId: 'incomplete', name: STATE_COMMAND, args: JSON.stringify({ v: 3, revision: 1, next: { mode: PLAN_MODE } }), source: { kind: 'user' } })
  session.append('command/run', { commandId: 'malformed', name: STATE_COMMAND, args: '{', source: { kind: 'user' } })
  session.append('command/done', { commandId: 'malformed', kind: 'success' })
  session.append('command/run', { commandId: 'unsupported', name: STATE_COMMAND, args: JSON.stringify({ v: 99, revision: 1, next: { mode: PLAN_MODE } }), source: { kind: 'user' } })
  session.append('command/done', { commandId: 'unsupported', kind: 'success' })
  appendStateSnapshot(session, { v: 3, revision: 2, next: { mode: PLAN_MODE } })
  appendStateSnapshot(session, { v: 3, revision: 1, next: { mode: BUILD_MODE } })

  assert.deepEqual(modeView(foldModeState(session.events)), { revision: 2, next: PLAN_MODE, current: null })
})

test('package-private selection operation routes to the same authority and preserves failures', async () => {
  const session = createSession()
  const authority = createWorkflowConfiguration()
  const select = createSelectionOperation(authority, ({ sessionId }) => {
    assert.equal(sessionId, session.id)
    return { session }
  })
  assert.deepEqual(await select({ sessionId: session.id, mode: PLAN_MODE }), {
    kind: 'changed', revision: 1, next: PLAN_MODE, applies: 'idle',
  })

  const failure = new Error('rpc lookup failed verbatim')
  const failing = createSelectionOperation(authority, async () => { throw failure })
  await assert.rejects(failing({ sessionId: session.id, mode: BUILD_MODE }), failure)
  assert.deepEqual(authority.view(session), { revision: 1, next: PLAN_MODE, current: null })
})

test('bplan command uses the shared selection operation and preserves failures', async () => {
  const session = createSession()
  const authority = createWorkflowConfiguration()
  const command = createModeCommand(authority)
  assert.deepEqual(await command.handler({ agent: { session }, rawInput: ' plan ' }), {
    kind: 'success', text: 'Next message mode: plan.',
  })
  assert.deepEqual(authority.view(session), { revision: 1, next: PLAN_MODE, current: null })
  await assert.rejects(command.handler({ agent: { session }, rawInput: 'invalid' }), /invalid build\/plan mode/)

  const failing = createSession('failing')
  failing.append = () => { throw new Error('append failed') }
  await assert.rejects(command.handler({ agent: { session: failing }, rawInput: 'plan' }), /append failed/)
})

test('workflow configuration exposes exactly the view and selectMode operations', async () => {
  const session = createSession()
  const agent = { session }
  const configuration = createWorkflowConfiguration()
  assert.deepEqual(configuration.view(session), { revision: 0, next: BUILD_MODE, current: null })
  assert.deepEqual(await configuration.selectMode(agent, PLAN_MODE), {
    kind: 'changed', revision: 1, next: PLAN_MODE, applies: 'idle',
  })
  assert.deepEqual(configuration.view(session), { revision: 1, next: PLAN_MODE, current: null })
  assert.deepEqual(await configuration.selectMode(agent, PLAN_MODE), {
    kind: 'noop', revision: 1, next: PLAN_MODE, applies: 'idle',
  })
  assert.deepEqual(Object.keys(configuration).sort(), ['selectMode', 'view'])
})

test('reviewed observation allowlist is the single Plan tool authority', () => {
  for (const name of PLAN_OBSERVATION_TOOLS) {
    assert.deepEqual(policyFor({ capability: 'tool', mode: PLAN_MODE, name, arguments: {} }), { kind: 'delegate' }, name)
  }

  for (const name of [...PARENT_DENIED_TOOLS, 'write', 'edit', 'unknown_tool']) {
    assert.deepEqual(policyFor({ capability: 'tool', mode: PLAN_MODE, name, arguments: {} }), {
      kind: 'deny', reason: PLAN_POLICY_DENIAL,
    }, name)
  }

  assert.deepEqual(policyFor({ capability: 'sandbox', mode: BUILD_MODE }), { kind: 'delegate' })
  assert.deepEqual(policyFor({ capability: 'sandbox', mode: PLAN_MODE }), { kind: 'deny', reason: PLAN_POLICY_DENIAL })
})

test('Plan denial identifies file and Harness runtime protection and requires execution handoff', () => {
  assert.equal(
    PLAN_POLICY_DENIAL,
    'Plan mode protects files and Harness runtime state. This tool cannot run because it may mutate state. Continue read-only investigation, produce an 执行计划 handoff, then ask the user to select Build and request execution.',
  )
})

test('Plan guidance is a pure semantic oracle for small, large, denial, and execution-request cases', () => {
  const required = [
    'Complete useful read-only investigation',
    'If a mutation tool is denied, continue with available reads',
    'headed exactly `执行计划`',
    'Do not call `exit_plan_mode`',
    'native Plan Review',
    'perform or claim execution',
    'complete proposed content',
    'never by a hard line-count rule',
    'goal, every affected area',
    'important interfaces and constraints',
    'focused validation, and rollback',
    'select Build and send an execution request',
    'asks to execute while this turn is Plan',
    'do not execute or elevate permissions',
  ]
  for (const phrase of required) assert.match(PLAN_GUIDANCE, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), phrase)
})

test('Plan guidance defines ordinary Build conversation semantics without registry or lifecycle state', () => {
  const required = [
    'Build selection by itself performs no work',
    'latest user message and current conversation',
    'proceed on clear execution intent',
    'minor in-scope adjustments',
    'ask exactly one concise question',
    'genuinely ambiguous',
    'scope-expanding or architecture-changing feedback',
    'revised Plan handoff',
    'Success, failure, cancellation, and retry remain ordinary chat and tool behavior',
  ]
  for (const phrase of required) assert.ok(PLAN_GUIDANCE.includes(phrase), phrase)
  assert.match(PLAN_GUIDANCE, /no handoff lifecycle state/)
  assert.match(PLAN_GUIDANCE, /Do not .*create a handoff ID.*plan registry.*pending-plan state.*lifecycle marker/)
})

test('Plan handoff guidance pins every representative semantic case without hidden lifecycle state', () => {
  const cases = new Map([
    ['small output', ['practical small, low-risk request', 'complete proposed content', 'never by a hard line-count rule']],
    ['large handoff', ['goal, every affected area', 'intended change in each area', 'important interfaces and constraints', 'focused validation, and rollback']],
    ['denial recovery', ['If a mutation tool is denied', 'continue with available reads', 'best supported handoff']],
    ['Plan execution request', ['asks to execute while this turn is Plan', 'do not execute or elevate permissions', 'select Build and send the execution request']],
    ['clear Build intent', ['latest user message and current conversation', 'proceed on clear execution intent']],
    ['ambiguous Build intent', ['ask exactly one concise question', 'genuinely ambiguous']],
    ['minor adjustment', ['minor in-scope adjustments']],
    ['scope expansion', ['scope-expanding or architecture-changing feedback', 'revised Plan handoff']],
    ['ordinary outcomes', ['Success, failure, cancellation, and retry remain ordinary chat and tool behavior', 'no handoff lifecycle state']],
  ])
  for (const [name, phrases] of cases) {
    for (const phrase of phrases) assert.ok(PLAN_GUIDANCE.includes(phrase), `${name}: ${phrase}`)
  }
})

test('selecting Build is inert beyond Next mode and creates no handoff registry state', async () => {
  const session = createSession('build-inert')
  const workflow = createWorkflowConfiguration()
  await workflow.selectMode({ session }, PLAN_MODE)
  freezeTurn(session, 1)
  const before = session.events.length

  assert.deepEqual(await workflow.selectMode({ session }, BUILD_MODE), {
    kind: 'changed', revision: 2, next: BUILD_MODE, applies: 'next-turn',
  })
  assert.equal(session.events.length, before + 2)
  assert.deepEqual(session.events.slice(-2).map((event) => [event.type, event.data.name ?? event.data.kind]), [
    ['command/run', STATE_COMMAND],
    ['command/done', 'success'],
  ])
  assert.deepEqual(workflow.view(session), {
    revision: 2,
    next: BUILD_MODE,
    current: { turn: 1, mode: PLAN_MODE },
  })
  const state = foldModeState(session.events)
  for (const field of ['handoff', 'handoffId', 'pendingPlan', 'planRegistry', 'lifecycle']) {
    assert.equal(Object.hasOwn(state, field), false, field)
  }
})

test('prompt section evaluates frozen Current mode on every model continuation and Build is empty', async () => {
  const planSession = createSession('prompt-plan')
  const buildSession = createSession('prompt-build')
  const authority = createWorkflowConfiguration()
  await authority.selectMode({ session: planSession }, PLAN_MODE)
  freezeTurn(planSession, 1)
  freezeTurn(buildSession, 1)
  const section = createPromptSection(authority)

  assert.deepEqual({ name: section.name, order: section.order }, { name: 'bplan:plan-guidance', order: 50 })
  assert.equal(section.text({ agent: { session: planSession } }), PLAN_GUIDANCE)
  await authority.selectMode({ session: planSession }, BUILD_MODE)
  assert.equal(section.text({ agent: { session: planSession } }), PLAN_GUIDANCE)
  assert.equal(section.text({ agent: { session: planSession } }), PLAN_GUIDANCE)
  assert.equal(section.text({ agent: { session: buildSession } }), '')
  assert.equal(section.text({}), '')

  endTurn(planSession, 1)
  freezeTurn(planSession, 2)
  assert.equal(section.text({ agent: { session: planSession } }), '')
})

test('prompt adapter registers one lifecycle-owned dynamic system section', () => {
  const authority = createWorkflowConfiguration()
  const calls = []
  const disposer = () => calls.push('disposed')
  const ctx = {
    systemPrompt: {
      section(definition) {
        calls.push(definition)
        return disposer
      },
    },
  }

  assert.equal(installPromptAdapter(ctx, authority), disposer)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].text({}), '')
  disposer()
  assert.equal(calls[1], 'disposed')
})

test('Plan guard delegates reviewed observations and denies mutation, shell, escalation, and unknown tools', async () => {
  const session = createSession()
  const authority = createWorkflowConfiguration()
  await authority.selectMode({ session }, PLAN_MODE)
  freezeTurn(session, 1)
  const guard = createToolGuard(authority)

  for (const name of [...PLAN_OBSERVATION_TOOLS]) {
    assert.equal(guard({ name, arguments: {}, agent: { session } }), undefined, name)
  }

  for (const exec of [
    { name: 'read', arguments: { sandbox_permissions: 'danger-full-access' }, agent: { session } },
    ...( [...PARENT_DENIED_TOOLS, 'write', 'edit', 'unknown_tool']
      .map((name) => ({ name, arguments: {}, agent: { session } })) ),
  ]) {
    assert.equal(guard(exec), PLAN_POLICY_DENIAL, exec.name)
  }
})

test('guard denial remains monotonic after pre-execute and prevents the tool body', async () => {
  const session = createSession()
  const authority = createWorkflowConfiguration()
  await authority.selectMode({ session }, PLAN_MODE)
  freezeTurn(session, 1)
  const guard = createToolGuard(authority)
  let preExecuteCalls = 0
  let bodyCalls = 0

  const dispatch = async (exec) => {
    preExecuteCalls += 1
    const reason = guard(exec)
    if (reason !== undefined) return { kind: 'deny', reason }
    bodyCalls += 1
    return { kind: 'allow' }
  }

  assert.deepEqual(await dispatch({ name: 'write', arguments: {}, agent: { session } }), {
    kind: 'deny', reason: PLAN_POLICY_DENIAL,
  })
  assert.equal(preExecuteCalls, 1)
  assert.equal(bodyCalls, 0)
})

test('mid-turn Next Build keeps Current Plan guard and frozen Build delegates every tool', async () => {
  const session = createSession()
  const authority = createWorkflowConfiguration()
  await authority.selectMode({ session }, PLAN_MODE)
  freezeTurn(session, 1)
  await authority.selectMode({ session }, BUILD_MODE)
  const guard = createToolGuard(authority)
  assert.equal(guard({ name: 'write', arguments: {}, agent: { session } }), PLAN_POLICY_DENIAL)

  endTurn(session, 1)
  freezeTurn(session, 2)
  for (const name of ['read', 'write', 'pwsh', 'unknown_tool']) {
    assert.equal(guard({ name, arguments: { sandbox_permissions: 'danger-full-access' }, agent: { session } }), undefined, name)
  }
})

test('tool adapter installs only at public guard seam and disposal restores baseline', async () => {
  const session = createSession()
  const authority = createWorkflowConfiguration()
  await authority.selectMode({ session }, PLAN_MODE)
  freezeTurn(session, 1)
  const calls = []
  let registeredGuard
  const ctx = {
    get() { return undefined },
    tools: {
      guard(value) {
        calls.push('guard')
        registeredGuard = value
        return () => { calls.push('disposed'); registeredGuard = undefined }
      },
    },
  }
  const dispose = installToolPolicyAdapter(ctx, authority)
  assert.equal(registeredGuard({ name: 'write', arguments: {}, agent: { session } }), PLAN_POLICY_DENIAL)
  dispose()
  assert.equal(registeredGuard, undefined)
  assert.deepEqual(calls, ['guard', 'disposed'])
})

test('Core host activation registers projection, prompt, tools, commands, and subagents without model contracts', async () => {
  const calls = []
  const effects = []
  let commandDefinition
  let stateReads = 0
  const services = {
    sessionProjections: {
      stateOf(session, key) { stateReads += 1; assert.equal(key, MODE_PROJECTION_KEY); return foldModeState(session.events) },
      register(definition) { calls.push(['register', definition.key, definition.stateVersion]); return () => calls.push('projection disposed') },
    },
    systemPrompt: {
      section(definition) { calls.push(['section', definition.name]); return () => calls.push('prompt disposed') },
    },
    tools: {
      guard() { calls.push('guard'); return () => calls.push('tools disposed') },
    },
    commands: {
      register(definition) { commandDefinition = definition; calls.push(['command', definition.name]); return () => calls.push('command disposed') },
    },
    subagents: {
      registerContinuableSetup(setup) { calls.push(['continuable setup', typeof setup]); return () => calls.push('setup disposed') },
    },
  }
  const ctx = {
    get(name) { return services[name] },
    inject(dependencies, activate) {
      const name = dependencies[0]
      if (name === 'sessionProjections') {
        return activate({ sessionProjections: services.sessionProjections })
      }
      if (name === 'systemPrompt') return activate({ systemPrompt: services.systemPrompt })
      if (name === 'tools') return activate({ tools: services.tools, get() { return { get() {}, isOwnedBy() { return false } } } })
      if (name === 'commands') return activate({ commands: services.commands })
      if (name === 'subagents') return activate({ subagents: services.subagents, get() { return { get() {} } } })
      assert.fail(`unexpected injection: ${dependencies.join(',')}`)
    },
    effect(register) { const dispose = register(); effects.push(dispose); return dispose },
  }
  plugin.apply(ctx)
  assert.deepEqual(calls.slice(0, 5), [
    ['register', MODE_PROJECTION_KEY, 3],
    ['section', 'bplan:plan-guidance'],
    'guard',
    ['command', 'bplan'],
    ['continuable setup', 'function'],
  ])
  const session = createSession('host-state-of')
  assert.deepEqual(await commandDefinition.handler({ agent: { session }, rawInput: PLAN_MODE }), {
    kind: 'success', text: 'Next message mode: plan.',
  })
  assert.equal(stateReads, 2)
  effects[0]()
  assert.deepEqual(calls.slice(5), [
    'setup disposed', 'command disposed', 'tools disposed', 'prompt disposed', 'projection disposed',
  ])
})

test('Core host activation skips subagents when the optional service is absent', () => {
  const calls = []
  const effects = []
  const services = {
    sessionProjections: { stateOf(session) { return foldModeState(session.events) }, register() { calls.push('projection'); return () => {} } },
    systemPrompt: { section() { calls.push('prompt'); return () => {} } },
    tools: { guard() { calls.push('tools'); return () => {} } },
    commands: { register() { calls.push('command'); return () => {} } },
  }
  const ctx = {
    get(name) { return services[name] },
    inject(dependencies, callback) {
      const name = dependencies[0]
      if (name === 'tools') return callback({ tools: services.tools })
      return callback({ [name]: services[name] })
    },
    effect(register) { const dispose = register(); effects.push(dispose); return dispose },
  }
  plugin.apply(ctx)
  assert.deepEqual(calls, ['projection', 'prompt', 'tools', 'command'])
  assert.equal(effects.length, 1)
})

test('Host entry waits for Core services that arrive after root startup', () => {
  const calls = []
  let waitForServices
  const services = {}
  const ctx = {
    get() { return undefined },
    inject(dependencies, callback) {
      if (waitForServices === undefined) {
        waitForServices = callback
        return () => calls.push('wait disposed')
      }
      const name = dependencies[0]
      if (name === 'tools') return callback({ tools: services.tools })
      return callback({ [name]: services[name] })
    },
    effect(register) { return register() },
  }

  plugin.apply(ctx)
  assert.deepEqual(calls, [])
  Object.assign(services, {
    sessionProjections: { stateOf(session) { return foldModeState(session.events) }, register() { calls.push('projection'); return () => {} } },
    systemPrompt: { section() { calls.push('prompt'); return () => {} } },
    tools: { guard() { calls.push('tools'); return () => {} } },
    commands: { register() { calls.push('command'); return () => {} } },
  })
  waitForServices(services)
  assert.equal(calls[0], 'projection')
})

test('Host entry activates from provided callable services before their Fibers report active', () => {
  const calls = []
  const services = {
    sessionProjections: { stateOf(session) { return foldModeState(session.events) }, register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    tools: { guard() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  const ctx = {
    get(name, strict) {
      if (strict !== false) return undefined
      return services[name]
    },
    inject(dependencies) {
      calls.push(dependencies[0])
      return () => {}
    },
    effect(register) { return register() },
  }

  plugin.apply(ctx)
  assert.deepEqual(calls, [
    'sessionProjections', 'systemPrompt', 'tools', 'commands',
  ])
})

test('Host entry settles incompatible without any downstream registration', () => {
  const calls = []
  const diagnostics = []
  let activate
  const ctx = {
    get() { return undefined },
    inject(_dependencies, callback) { calls.push('inject'); activate = callback },
    effect() { calls.push('effect') },
    reportDiagnostic(diagnostic) { diagnostics.push(diagnostic) },
  }

  assert.doesNotThrow(() => plugin.apply(ctx))
  assert.deepEqual(calls, ['inject'])
  assert.doesNotThrow(() => activate({
    sessionProjections: {},
    systemPrompt: { section() {} },
    tools: { guard() {} },
    commands: { register() {} },
  }))
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].state, 'incompatible')
  assert.equal(diagnostics[0].half, 'host')
  assert.match(diagnostics[0].reason, /sessionProjections/)
})

test('Host entry contains projection registration conflict without partial installation', async () => {
  const diagnostics = []
  const projectionService = {
    stateOf(session) { return foldModeState(session.events) },
    register() { throw new Error('session projection bplanMode is already registered at stateVersion 3') },
  }
  const ctx = {
    get(name) {
      if (name === 'sessionProjections') return projectionService
      if (name === 'systemPrompt') return { section() {} }
      if (name === 'tools') return { guard() {} }
      if (name === 'commands') return { register() {} }
      return undefined
    },
    inject(dependencies, callback) {
      assert.equal(dependencies[0], 'sessionProjections')
      return callback({ sessionProjections: projectionService })
    },
    reportDiagnostic(diagnostic) { diagnostics.push(diagnostic) },
  }

  await assert.doesNotReject(() => plugin.apply(ctx))
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].state, 'conflict')
  assert.equal(diagnostics[0].half, 'host')
})

test('Host entry unwinds every acquired registration in reverse when a delayed activation fails', async () => {
  const calls = []
  const diagnostics = []
  const callbacks = []
  const services = {
    sessionProjections: { stateOf(session) { return foldModeState(session.events) }, register() { return () => calls.push('sessionProjections disposed') } },
    systemPrompt: { section() { return () => calls.push('systemPrompt disposed') } },
    tools: { guard() { return () => calls.push('tools disposed') } },
    commands: { register() { return () => calls.push('commands disposed') } },
  }
  const ctx = {
    get(name) { return services[name] },
    inject(dependencies, callback) {
      callbacks.push([dependencies[0], callback])
      return () => calls.push(`${dependencies[0]} disposed`)
    },
    effect(register) { return register() },
    reportDiagnostic(diagnostic) { diagnostics.push(diagnostic) },
  }

  plugin.apply(ctx)
  await assert.doesNotReject(() => callbacks[0][1]({
    sessionProjections: { stateOf(session) { return foldModeState(session.events) }, register() { throw new Error('delayed projection failure') } },
  }))
  assert.deepEqual(calls, [
    'commands disposed', 'tools disposed', 'systemPrompt disposed', 'sessionProjections disposed',
  ])
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].state, 'failed')
  assert.equal(diagnostics[0].reason, 'delayed projection failure')
})

test('Host entry transaction unwinds acquired registrations exactly once after installation failure', async () => {
  const calls = []
  const diagnostics = []
  let injectCount = 0
  const services = {
    sessionProjections: { stateOf(session) { return foldModeState(session.events) }, register() { calls.push('projection'); return () => calls.push('projection disposed') } },
    systemPrompt: { section() { return () => {} } },
    tools: { guard() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  const ctx = {
    get(name) { return services[name] },
    inject(dependencies, callback) {
      injectCount += 1
      if (injectCount === 2) throw new Error('prompt installation failed')
      const name = dependencies[0]
      if (name === 'tools') return callback({ tools: services.tools })
      return callback({ [name]: services[name] })
    },
    reportDiagnostic(diagnostic) { diagnostics.push(diagnostic) },
  }

  await assert.doesNotReject(() => plugin.apply(ctx))
  assert.deepEqual(calls, ['projection', 'projection disposed'])
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].state, 'failed')
  assert.equal(diagnostics[0].reason, 'prompt installation failed')
})

test('Host entry reports cleanup failures without escaping activation containment', async () => {
  const diagnostics = []
  const projectionService = {
    stateOf(session) { return foldModeState(session.events) },
    register() { return () => { throw new Error('projection cleanup failed') } },
  }
  const ctx = {
    get(name) {
      if (name === 'sessionProjections') return projectionService
      if (name === 'systemPrompt') return { section() {} }
      if (name === 'tools') return { guard() {} }
      if (name === 'commands') return { register() {} }
      return undefined
    },
    inject(dependencies, callback) {
      if (dependencies[0] === 'sessionProjections') return callback({ sessionProjections: projectionService })
      throw new Error('downstream installation failed')
    },
    reportDiagnostic(diagnostic) { diagnostics.push(diagnostic) },
  }

  await assert.doesNotReject(() => plugin.apply(ctx))
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].state, 'failed')
  assert.match(diagnostics[0].reason, /downstream installation failed; cleanup failed: projection cleanup failed/)
})

test('Host stop awaits asynchronous registration disposal before remount', async () => {
  let releaseProjection
  let projectionDisposed = false
  const effects = []
  const services = {
    sessionProjections: {
      stateOf(session) { return foldModeState(session.events) },
      register() { return () => new Promise((resolve) => {
        releaseProjection = () => {
          projectionDisposed = true
          resolve()
        }
      }) },
    },
    systemPrompt: { section() { return () => {} } },
    tools: { guard() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  const ctx = {
    get(name) { return services[name] },
    inject(dependencies, callback) {
      const name = dependencies[0]
      if (name === 'tools') return callback({ tools: services.tools })
      return callback({ [name]: services[name] })
    },
    effect(register) {
      const dispose = register()
      effects.push(dispose)
      return dispose
    },
  }

  plugin.apply(ctx)
  let stopped = false
  const stopping = effects[0]().then(() => { stopped = true })
  for (let index = 0; index < 10 && releaseProjection === undefined; index += 1) {
    await Promise.resolve()
  }
  assert.equal(typeof releaseProjection, 'function')
  assert.equal(projectionDisposed, false)
  assert.equal(stopped, false)
  releaseProjection()
  await stopping
  assert.equal(projectionDisposed, true)
  assert.equal(stopped, true)
})

test('Host entry activates once after an incompatible attempt and stop disposes in reverse order', async () => {
  const calls = []
  const effects = []
  let compatible = false
  const services = {
    sessionProjections: { stateOf(session) { return foldModeState(session.events) }, register() { calls.push('projection'); return () => calls.push('projection disposed') } },
    systemPrompt: { section() { calls.push('prompt'); return () => calls.push('prompt disposed') } },
    tools: { guard() { calls.push('tools'); return () => calls.push('tools disposed') } },
    commands: { register() { calls.push('command'); return () => calls.push('command disposed') } },
  }
  const ctx = {
    get(name, strict) {
      if (name === 'sessionProjections') return compatible ? services.sessionProjections : undefined
      if (strict === false) return services[name]
      return services[name]
    },
    inject(dependencies, callback) {
      if (Array.isArray(dependencies) && dependencies.length > 1) return () => {}
      const name = dependencies[0]
      if (name === 'tools') return callback({ tools: services.tools })
      return callback({ [name]: services[name] })
    },
    effect(register) {
      const dispose = register()
      effects.push(dispose)
      return dispose
    },
  }

  plugin.apply(ctx)
  compatible = true
  plugin.apply(ctx)
  assert.deepEqual(calls, ['projection', 'prompt', 'tools', 'command'])
  await effects[0]()
  assert.deepEqual(calls.slice(4), [
    'command disposed', 'tools disposed', 'prompt disposed', 'projection disposed',
  ])
})
