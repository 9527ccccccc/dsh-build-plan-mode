import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILD_MODE,
  PLAN_GUIDANCE,
  PLAN_MODE,
  PLAN_POLICY_DENIAL,
  createWorkflowConfiguration,
  createToolGuard,
  policyFor,
} from '../src/index.js'
import {
  canInterruptResearchChild,
  classifyResearchChild,
  createContinuableResearchSetup,
  createResearchGuard,
  installResearchRestrictions,
  isResearchChild,
} from '../src/research-child.js'
import { TOOL_CLASSES } from '../src/tool-taxonomy.js'

function session(id, parentSession, options = {}) {
  const events = []
  return {
    id,
    header: { id, ...(parentSession === undefined ? {} : { parentSession }), ...options },
    events,
    append(type, data) { const event = { type, data }; events.push(event); return event },
  }
}

function appendModeSnapshot(target, mode, revision = 1) {
  const commandId = `test-bplan-state-${revision}`
  target.append('command/run', {
    commandId,
    name: 'bplan-state',
    args: JSON.stringify({ v: 3, revision, next: { mode } }),
    source: { kind: 'user' },
  })
  target.append('command/done', { commandId, kind: 'success' })
}

function planParent(id = 'parent', mode = PLAN_MODE) {
  const parentSession = session(id)
  const authority = createWorkflowConfiguration()
  appendModeSnapshot(parentSession, mode)
  parentSession.append('turn/start', { turn: 1 })
  return { session: parentSession, authority }
}

function options(authority = createWorkflowConfiguration(), overrides = {}) {
  return {
    authority,
    planMode: PLAN_MODE,
    policyFor,
    denial: PLAN_POLICY_DENIAL,
    guidance: `${PLAN_GUIDANCE}\nResearch Child`,
    ...overrides,
  }
}

/** agents fixture: live map plus exact-owner registry semantics. */
function agentsFixture(entries = {}) {
  const live = new Map(Object.entries(entries))
  return {
    get(id) { return live.get(id) },
    isOwnedBy(id, owner) {
      const target = live.get(id)
      return target !== undefined && owner !== undefined && target.owner === owner
    },
  }
}

function childCtxFixture(child, calls) {
  return {
    agent: child,
    get(name) {
      if (name === 'tools') return { guard(fn) { calls.push(['guard', fn]); return () => calls.push('guard disposed') } }
      if (name === 'systemPrompt') return { section(value) { calls.push(['prompt', value.name, value.text()]); return () => calls.push('prompt disposed') } }
      return undefined
    },
  }
}

test('§13.4.1 continuable setup classifies synchronously before first tool use', () => {
  // Both supported entry points (subagent and subagent_fork) materialize
  // through the same continuable setup seam; this test proves the seam
  // classifies the child BEFORE installing guard/prompt.
  const { session: parentSession, authority } = planParent()
  const parent = { session: parentSession }
  const agents = agentsFixture({ parent: { ...parent, owner: parent } })
  const child = { session: session('child', 'parent') }
  const calls = []
  const dispose = createContinuableResearchSetup(agents, options(authority))(childCtxFixture(child, calls))
  assert.equal(isResearchChild(child.session), true)
  assert.equal(calls[0][0], 'guard')
  assert.equal(calls[1][0], 'prompt')
  assert.equal(calls.length, 2)
  dispose()
})

test('§13.4.2 foreground and noncontinuable children deny at policy and guard layers', () => {
  for (const name of ['subagent', 'subagent_fork']) {
    assert.deepEqual(policyFor({ capability: 'tool', mode: PLAN_MODE, name, arguments: { run_in_background: false } }), {
      kind: 'deny', reason: PLAN_POLICY_DENIAL,
    })
    const guard = createResearchGuard(policyFor, PLAN_MODE, PLAN_POLICY_DENIAL)
    assert.equal(guard({ name, arguments: { run_in_background: false } }), PLAN_POLICY_DENIAL)
  }
})

test('§13.4.3 parent mode change does not alter a classified child policy (lifetime fixed)', () => {
  const { session: parentSession, authority } = planParent()
  const parent = { session: parentSession }
  const agents = agentsFixture({ parent: { ...parent, owner: parent } })
  const childSession = session('child', 'parent')
  const child = { session: childSession }
  assert.equal(classifyResearchChild(child, agents, options(authority)), true)

  // Parent switches Next to Build mid-turn; child stays classified.
  appendModeSnapshot(parentSession, BUILD_MODE, 2)
  assert.equal(isResearchChild(childSession), true)

  // The guard is fixed Plan regardless of any parent/authority change.
  const guard = createResearchGuard(policyFor, PLAN_MODE, PLAN_POLICY_DENIAL)
  assert.equal(guard({ name: 'write', arguments: {} }), PLAN_POLICY_DENIAL)
  assert.equal(guard({ name: 'read', arguments: {} }), undefined)
})

test('§13.4.4 cold resume reconstructs classification from live parent or seed prefix', () => {
  // Live-parent reconstruction: a resumed child re-runs setup and reclassifies
  // from the live direct parent's frozen Plan.
  const { session: parentSession, authority } = planParent()
  const parent = { session: parentSession }
  const agents = agentsFixture({ parent: { ...parent, owner: parent } })
  const resumed = { session: session('child', 'parent', { seedLength: 4 }) }
  resumed.session.events.push(...Array.from({ length: 4 }, (_, i) => ({ type: 'x', data: { i } })))
  const calls = []
  const dispose = createContinuableResearchSetup(agents, options(authority))(childCtxFixture(resumed, calls))
  assert.equal(isResearchChild(resumed.session), true)
  assert.equal(calls.length, 2)
  dispose()

  // Seed-prefix reconstruction: no live parent; the immutable seed prefix
  // carries the frozen Plan state at delegation.
  const parentEvents = parentSession.events
  const childSession = session('child2', 'parent', { seedLength: parentEvents.length })
  childSession.events.push(...parentEvents.map((e) => ({ ...e })))
  const noParent = agentsFixture({})
  const calls2 = []
  const dispose2 = createContinuableResearchSetup(noParent, options(authority))(childCtxFixture({ session: childSession }, calls2))
  assert.equal(isResearchChild(childSession), true)
  assert.equal(calls2.length, 2)
  dispose2()
})

test('§13.4.5 child mutation, shell, descendants, orchestration, and unrelated interruption deny', () => {
  const guard = createResearchGuard(policyFor, PLAN_MODE, PLAN_POLICY_DENIAL)

  // child cannot mutate files or Harness runtime state
  for (const name of ['write', 'edit', ...TOOL_CLASSES.runtimeMutation]) {
    assert.equal(guard({ name, arguments: {} }), PLAN_POLICY_DENIAL, name)
  }
  // shell interpreters and code execution are denied even though the parent
  // Plan allowlist still reviews them (04 removes them at the Plan layer)
  for (const name of TOOL_CLASSES.interpreter) {
    assert.equal(guard({ name, arguments: {} }), PLAN_POLICY_DENIAL, name)
  }
  // no descendants, no orchestration, no goal mutation, no job kill
  for (const name of [...TOOL_CLASSES.orchestration, ...TOOL_CLASSES.goalMutation, ...TOOL_CLASSES.agentControl]) {
    assert.equal(guard({ name, arguments: {} }), PLAN_POLICY_DENIAL, name)
  }
  // explicit sandbox escalation is denied
  assert.equal(guard({ name: 'read', arguments: { sandbox_permissions: 'danger-full-access' } }), PLAN_POLICY_DENIAL)
  // a child can never interrupt anything
  assert.equal(guard({ name: 'interrupt_agent', arguments: { agent_id: 'unrelated' } }), PLAN_POLICY_DENIAL)
})

test('§13.4.5 child cannot interrupt an unrelated or indirect target', () => {
  const { session: parentSession, authority } = planParent()
  const parent = { session: parentSession }
  const child = { session: session('child', 'parent') }
  const unrelated = { session: session('unrelated') }
  const indirect = { session: session('indirect', 'child') } // child's own descendant
  const agents = agentsFixture({
    parent: { ...parent, owner: parent },
    child: { ...child, owner: parent },
    unrelated: { ...unrelated, owner: parent },
    indirect: { ...indirect, owner: child },
  })
  classifyResearchChild(child, agents, options(authority))

  // a child is never authorized to interrupt anything
  assert.equal(canInterruptResearchChild(child, 'unrelated', agents), false)
  assert.equal(canInterruptResearchChild(child, 'indirect', agents), false)
  // parent can interrupt its direct classified child
  assert.equal(canInterruptResearchChild(parent, 'child', agents), true)
})

test('§13.4.6 exact direct parent interrupts its owned classified child; unrelated and indirect fail', () => {
  const { session: parentSession, authority } = planParent()
  const parent = { session: parentSession }
  const other = { session: session('other') }
  const child = { session: session('child', 'parent') }
  const grandchild = { session: session('grandchild', 'child') }
  const agents = agentsFixture({
    parent: { ...parent, owner: parent },
    other: { ...other, owner: other },
    child: { ...child, owner: parent },
    grandchild: { ...grandchild, owner: child },
  })
  classifyResearchChild(child, agents, options(authority))

  assert.equal(canInterruptResearchChild(parent, 'child', agents), true)
  // unrelated parent cannot interrupt
  assert.equal(canInterruptResearchChild(other, 'child', agents), false)
  // indirect target (grandchild) is not interruptible by the top parent
  assert.equal(canInterruptResearchChild(parent, 'grandchild', agents), false)
  // missing target
  assert.equal(canInterruptResearchChild(parent, 'missing', agents), false)
  // unclassified direct child is not interruptible
  const unclassified = { session: session('unclassified', 'parent') }
  const agents2 = agentsFixture({
    parent: { ...parent, owner: parent },
    unclassified: { ...unclassified, owner: parent },
  })
  assert.equal(canInterruptResearchChild(parent, 'unclassified', agents2), false)
})

test('§13.4.7 child model routing remains ordinary (no model-selection reads)', () => {
  const { session: parentSession, authority } = planParent()
  const parent = { session: parentSession }
  const agents = agentsFixture({ parent: { ...parent, owner: parent } })
  const child = { session: session('child', 'parent') }
  let modelReads = 0
  const childCtx = {
    agent: child,
    get(name) {
      if (name === 'tools') return { guard() { return () => {} } }
      if (name === 'systemPrompt') return { section() { return () => {} } }
      if (name === 'sessionModelSelection' || name === 'agentDefaultModel' || name === 'modelDirectories') modelReads += 1
      return undefined
    },
  }
  createContinuableResearchSetup(agents, options(authority))(childCtx)
  assert.equal(modelReads, 0, 'research child setup must not read model selection')
})

test('§13.4.8 child scope disposal removes guard and guidance exactly once in reverse order', () => {
  const { session: parentSession, authority } = planParent()
  const parent = { session: parentSession }
  const agents = agentsFixture({ parent: { ...parent, owner: parent } })
  const child = { session: session('child', 'parent') }
  const calls = []
  const dispose = createContinuableResearchSetup(agents, options(authority))(childCtxFixture(child, calls))
  assert.equal(isResearchChild(child.session), true)
  assert.equal(calls[0][0], 'guard')
  assert.equal(calls[1][0], 'prompt')
  dispose()
  dispose() // second dispose is a no-op
  assert.deepEqual(calls.slice(-2), ['prompt disposed', 'guard disposed'])
  assert.equal(calls.length, 4)
})

test('installResearchRestrictions installs only available services and returns a disposer', () => {
  const { session: parentSession, authority } = planParent()
  const parent = { session: parentSession }
  const agents = agentsFixture({ parent: { ...parent, owner: parent } })
  const child = { session: session('child', 'parent') }
  const dispose = createContinuableResearchSetup(agents, options(authority))({
    agent: child,
    get(name) {
      if (name === 'systemPrompt') return { section() { return () => {} } }
      return undefined
    },
  })
  dispose()
})

test('Research restriction installation rolls back guard when prompt registration fails', () => {
  const calls = []
  const failure = new Error('prompt registration failed')
  const childCtx = {
    get(name) {
      if (name === 'tools') return { guard() { calls.push('guard'); return () => calls.push('guard disposed') } }
      if (name === 'systemPrompt') return { section() { calls.push('prompt'); throw failure } }
      return undefined
    },
  }
  assert.throws(() => installResearchRestrictions(childCtx, options()), failure)
  assert.deepEqual(calls, ['guard', 'prompt', 'guard disposed'])
})

test('classification failure returns a no-op disposer without installing anything', () => {
  const authority = createWorkflowConfiguration()
  // Build parent: no frozen Plan
  const buildParentSession = session('build-parent')
  const buildParent = { session: buildParentSession }
  const agents = agentsFixture({ 'build-parent': { ...buildParent, owner: buildParent } })
  let installed = false
  const child = { session: session('child', 'build-parent') }
  const dispose = createContinuableResearchSetup(agents, options(authority))({
    agent: child,
    get() {
      installed = true
      return undefined
    },
  })
  dispose() // no-op
  assert.equal(installed, false)
  assert.equal(isResearchChild(child.session), false)
})

test('Plan parent marks a first-level continuable child before restrictions install', () => {
  const parentSession = session('parent')
  const authority = createWorkflowConfiguration()
  appendModeSnapshot(parentSession, PLAN_MODE)
  parentSession.append('turn/start', { turn: 1 })
  const parent = { session: parentSession }
  const child = { session: session('child', 'parent') }
  const agents = { get(id) { return id === 'parent' ? parent : undefined } }
  assert.equal(classifyResearchChild(child, agents, options(authority)), true)
  assert.deepEqual(child.session.events, [])
})

test('Build parent does not classify a child and no custom marker is appended', () => {
  const parentSession = session('parent')
  const authority = createWorkflowConfiguration()
  parentSession.append('turn/start', { turn: 1 })
  assert.equal(authority.view(parentSession).current.mode, BUILD_MODE)
  const parent = { session: parentSession }
  const agents = { get() { return parent } }
  const ordinary = { session: session('ordinary', 'parent') }
  assert.equal(classifyResearchChild(ordinary, agents, options(authority)), false)
  assert.equal(isResearchChild(ordinary.session), false)
  assert.deepEqual(ordinary.session.events, [])
})

test('Plan parent permits both continuable background entry points and denies foreground one-shot', () => {
  for (const name of ['subagent', 'subagent_fork']) {
    assert.deepEqual(policyFor({ capability: 'tool', mode: PLAN_MODE, name, arguments: {} }), { kind: 'delegate' })
    assert.deepEqual(policyFor({ capability: 'tool', mode: PLAN_MODE, name, arguments: { run_in_background: true } }), { kind: 'delegate' })
    assert.deepEqual(policyFor({ capability: 'tool', mode: PLAN_MODE, name, arguments: { run_in_background: false } }), {
      kind: 'deny', reason: PLAN_POLICY_DENIAL,
    })
  }
})

test('continuable setup installs child-owned guard and research prompt and disposes in reverse', () => {
  const parentSession = session('parent')
  const authority = createWorkflowConfiguration()
  appendModeSnapshot(parentSession, PLAN_MODE)
  parentSession.append('turn/start', { turn: 1 })
  const parent = { session: parentSession }
  const child = { session: session('child', 'parent') }
  const calls = []
  const childCtx = {
    agent: child,
    get(name) {
      if (name === 'tools') return { guard(fn) { calls.push(['guard', typeof fn]); return () => calls.push('guard disposed') } }
      if (name === 'systemPrompt') return { section(value) { calls.push(['prompt', value.name, value.text()]); return () => calls.push('prompt disposed') } }
    },
  }
  const dispose = createContinuableResearchSetup({ get() { return parent } }, options(authority))(childCtx)
  assert.equal(isResearchChild(child.session), true)
  assert.equal(calls[0][0], 'guard')
  assert.equal(calls[1][0], 'prompt')
  assert.match(calls[1][2], /Research Child/)
  dispose()
  assert.deepEqual(calls.slice(-2), ['prompt disposed', 'guard disposed'])
})

test('only the exact direct parent may interrupt its owned marked Research Child', () => {
  const parent = { session: session('parent') }
  const other = { session: session('other') }
  const childSession = session('child', 'parent')
  const child = { session: childSession }
  const authority = createWorkflowConfiguration()
  appendModeSnapshot(parent.session, PLAN_MODE)
  parent.session.append('turn/start', { turn: 1 })
  classifyResearchChild(child, agentsFixture({ parent: { ...parent, owner: parent } }), options(authority))
  const agents = {
    get(id) { return id === 'child' ? child : undefined },
    isOwnedBy(id, owner) { return id === 'child' && owner === parent },
  }
  assert.equal(canInterruptResearchChild(parent, 'child', agents), true)
  assert.equal(canInterruptResearchChild(other, 'child', agents), false)
  assert.equal(canInterruptResearchChild(parent, 'missing', agents), false)
})

test('Plan tool policy delegates only exact owned direct Research Child interruption', async () => {
  const parentSession = session('parent')
  const authority = createWorkflowConfiguration()
  appendModeSnapshot(parentSession, PLAN_MODE)
  parentSession.append('turn/start', { turn: 1 })
  const parent = { session: parentSession }
  const childSession = session('child', 'parent')
  const child = { session: childSession }
  const agents = {
    get(id) { return id === 'child' ? child : undefined },
    isOwnedBy(id, owner) { return id === 'child' && owner === parent },
  }
  classifyResearchChild(child, { get(id) { return id === 'parent' ? parent : undefined } }, options(authority))
  const guard = createToolGuard(authority, agents)
  assert.equal(guard({ name: 'interrupt_agent', arguments: { agent_id: 'child' }, agent: parent }), undefined)
  assert.equal(guard({ name: 'interrupt_agent', arguments: { agent_id: 'other' }, agent: parent }), PLAN_POLICY_DENIAL)
})
