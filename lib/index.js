import { canInterruptResearchChild, installResearchChildAdapter, isResearchChild } from './research-child.js'
import { BPLAN_CONTRACT } from './contract.js'
import { drainDisposers } from './disposer-drain.js'
import { CHILD_CREATING_TOOLS, CHILD_INTERRUPT_TOOL, PLAN_OBSERVATION_TOOLS } from './tool-taxonomy.js'

export const BUILD_MODE = 'build'
export const PLAN_MODE = 'plan'
export const MODE_PROJECTION_KEY = BPLAN_CONTRACT.projection.key
export const MODE_COMMAND = BPLAN_CONTRACT.commands.interactive
export const NEXT_SELECTED_EVENT = 'command/run'
export const TURN_FROZEN_EVENT = 'turn/start'
export const STATE_COMMAND = BPLAN_CONTRACT.commands.state
const LEGACY_NEXT_SELECTED_EVENT = 'bplan/next-selected'
const LEGACY_TURN_FROZEN_EVENT = 'bplan/turn-frozen'
export const PLAN_POLICY_DENIAL = 'Plan mode protects files and Harness runtime state. This tool cannot run because it may mutate state. Continue read-only investigation, produce an 执行计划 handoff, then ask the user to select Build and request execution.'
export const PLAN_GUIDANCE = `# Build / Plan Mode: frozen Plan turn

This turn is Plan and remains read-only through every continuation step. Complete useful read-only investigation before answering. If a mutation tool is denied, continue with available reads and still produce the best supported handoff.

Return an ordinary assistant message headed exactly \`执行计划\`. Do not call \`exit_plan_mode\`, invoke native Plan Review, change to Build, perform or claim execution, create a handoff ID, or rely on a plan registry, pending-plan state, or lifecycle marker.

For a practical small, low-risk request, especially a single-file change, include the complete proposed content when useful for review. Judge this by practicality and risk, never by a hard line-count rule. For a larger change, include the goal, every affected area, the intended change in each area, important interfaces and constraints, focused validation, and rollback. End every handoff by telling the user to select Build and send an execution request.

If the user asks to execute while this turn is Plan, do not execute or elevate permissions. Remind them to select Build and send the execution request. Build selection by itself performs no work. In a later Build turn, ordinary conversation semantics apply: use the latest user message and current conversation; proceed on clear execution intent, including minor in-scope adjustments; ask exactly one concise question only when the execution target is genuinely ambiguous; and route scope-expanding or architecture-changing feedback to a revised Plan handoff. Success, failure, cancellation, and retry remain ordinary chat and tool behavior with no handoff lifecycle state.`

// Classification authority lives in ./tool-taxonomy.js: this module consumes
// its aggregates, and unlisted tools fail closed in Plan.
const OBSERVATION_TOOLS = new Set(PLAN_OBSERVATION_TOOLS)
const CONTINUABLE_CHILD_TOOLS = new Set(CHILD_CREATING_TOOLS)

export function policyFor(subject) {
  if (subject.mode !== PLAN_MODE) return { kind: 'delegate' }
  if (subject.capability === 'sandbox') return { kind: 'deny', reason: PLAN_POLICY_DENIAL }
  if (subject.capability !== 'tool') return { kind: 'deny', reason: PLAN_POLICY_DENIAL }

  const args = subject.arguments
  if (args !== null && typeof args === 'object') {
    if (args.sandbox_permissions !== undefined) return { kind: 'deny', reason: PLAN_POLICY_DENIAL }
    if (CONTINUABLE_CHILD_TOOLS.has(subject.name)) {
      return args.run_in_background === false
        ? { kind: 'deny', reason: PLAN_POLICY_DENIAL }
        : { kind: 'delegate' }
    }
  }
  return OBSERVATION_TOOLS.has(subject.name)
    ? { kind: 'delegate' }
    : { kind: 'deny', reason: PLAN_POLICY_DENIAL }
}

export function initialModeState() {
  return { schema: 3, revision: 0, next: BUILD_MODE, current: null, pendingSnapshots: {} }
}

export function isBuildPlanMode(mode) {
  return mode === BUILD_MODE || mode === PLAN_MODE
}

function assertMode(mode) {
  if (!isBuildPlanMode(mode)) {
    throw new TypeError(`invalid build/plan mode: ${String(mode)}`)
  }
}

function assertNextMode(mode) {
  if (!isBuildPlanMode(mode)) {
    throw new TypeError(`invalid build/plan next mode: ${String(mode)}`)
  }
}

function assertRevision(revision, minimum = 0) {
  if (!Number.isSafeInteger(revision) || revision < minimum) {
    throw new TypeError(`invalid build/plan revision: ${String(revision)}`)
  }
}

function assertSession(session) {
  if (session === null || typeof session !== 'object' || !Array.isArray(session.events) || typeof session.append !== 'function') {
    throw new TypeError('build/plan mode needs a live agent session')
  }
}

function copyCurrent(current) {
  return current === null ? null : { turn: current.turn, mode: current.mode }
}

export function modeView(state) {
  return {
    revision: state.revision ?? 0,
    next: state.next,
    current: copyCurrent(state.current),
  }
}

function parseSnapshot(args) {
  try {
    const snapshot = JSON.parse(args)
    if ((snapshot?.v !== 2 && snapshot?.v !== 3)
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
      || !isBuildPlanMode(snapshot.next?.mode)) return undefined
    return { v: snapshot.v, revision: snapshot.revision, next: { mode: snapshot.next.mode } }
  } catch {
    return undefined
  }
}

function snapshotState(state, snapshot, pendingSnapshots) {
  if (snapshot.revision <= state.revision) return { ...state, pendingSnapshots }
  return {
    schema: 3,
    next: snapshot.next.mode,
    current: copyCurrent(state.current),
    revision: snapshot.revision,
    pendingSnapshots,
  }
}

export function reduceModeState(state, event) {
  if (event.type === 'command/run' && typeof event.data.commandId === 'string') {
    let pending
    if (event.data.name === STATE_COMMAND && typeof event.data.args === 'string') {
      const snapshot = parseSnapshot(event.data.args)
      if (snapshot !== undefined) pending = { kind: 'snapshot', snapshot }
    } else if (event.data.name === MODE_COMMAND && state.revision === 0 && typeof event.data.args === 'string') {
      const mode = event.data.args.trim().toLowerCase()
      if (isBuildPlanMode(mode)) pending = { kind: 'legacy-mode', mode }
    }
    if (pending === undefined) return state
    return { ...state, pendingSnapshots: { ...state.pendingSnapshots, [event.data.commandId]: pending } }
  }
  if (event.type === 'command/done' && state.pendingSnapshots[event.data.commandId] !== undefined) {
    const pending = state.pendingSnapshots[event.data.commandId]
    const pendingSnapshots = { ...state.pendingSnapshots }
    delete pendingSnapshots[event.data.commandId]
    if (event.data.kind !== 'success') return { ...state, pendingSnapshots }
    if (pending.kind === 'snapshot') return snapshotState(state, pending.snapshot, pendingSnapshots)
    if (state.revision !== 0 || state.next === pending.mode) return { ...state, pendingSnapshots }
    return { ...state, next: pending.mode, current: copyCurrent(state.current), pendingSnapshots }
  }
  if (event.type === LEGACY_NEXT_SELECTED_EVENT) {
    if (state.revision !== 0 || !isBuildPlanMode(event.data.mode) || state.next === event.data.mode) return state
    return { ...state, next: event.data.mode, current: copyCurrent(state.current) }
  }
  if (event.type === LEGACY_TURN_FROZEN_EVENT) {
    if (state.current !== null || !Number.isSafeInteger(event.data.turn) || !isBuildPlanMode(event.data.mode)) return state
    return { ...state, current: { turn: event.data.turn, mode: event.data.mode } }
  }
  if (event.type === 'turn/start') {
    if (!Number.isSafeInteger(event.data.turn) || event.data.turn < 1) {
      throw new TypeError(`invalid build/plan turn: ${String(event.data.turn)}`)
    }
    if (state.current !== null) return state
    return { ...state, current: { turn: event.data.turn, mode: state.next } }
  }
  if (event.type === 'turn/end' && state.current !== null && event.data.turn === state.current.turn) {
    return { ...state, current: null }
  }
  return state
}

export function foldModeState(events) {
  return events.reduce(reduceModeState, initialModeState())
}

let commandSequence = 0

function nextStateCommandId() {
  commandSequence += 1
  return `${STATE_COMMAND}-${Date.now()}-${commandSequence}`
}

function snapshotFor(state, mode) {
  return {
    v: 3,
    revision: state.revision + 1,
    next: { mode },
  }
}

function appendSnapshot(session, snapshot) {
  const commandId = nextStateCommandId()
  session.append('command/run', {
    commandId,
    name: STATE_COMMAND,
    args: JSON.stringify(snapshot),
    source: { kind: 'user' },
  })
  session.append('command/done', { commandId, kind: 'success' })
}

export function createWorkflowConfiguration(options = {}) {
  const readState = options.readState ?? ((session) => foldModeState(session.events))
  const append = options.appendSnapshot ?? appendSnapshot
  const chains = new WeakMap()

  function serialize(session, operation) {
    const previous = chains.get(session) ?? Promise.resolve()
    const result = previous.then(operation)
    chains.set(session, result.then(() => undefined, () => undefined))
    return result
  }

  return {
    view(session) {
      assertSession(session)
      return modeView(readState(session))
    },
    selectMode(agent, mode) {
      assertMode(mode)
      const session = agent?.session
      assertSession(session)
      return serialize(session, () => {
        const state = readState(session)
        const applies = state.current === null ? 'idle' : 'next-turn'
        if (state.next === mode) return { kind: 'noop', revision: state.revision, next: mode, applies }
        const snapshot = snapshotFor(state, mode)
        append(session, snapshot)
        const committed = readState(session)
        if (committed.revision !== snapshot.revision || committed.next !== mode) {
          throw new Error('build/plan projection did not commit the selected mode')
        }
        return { kind: 'changed', revision: committed.revision, next: mode, applies }
      })
    },
  }
}

export function createModeProjectionDefinition() {
  const stateSchema = {
    parse(value) {
      assertNextMode(value?.next)
      assertRevision(value?.revision)
      if (value.current !== null) {
        if (!Number.isSafeInteger(value.current?.turn) || value.current.turn < 1) {
          throw new TypeError(`invalid build/plan turn: ${String(value.current?.turn)}`)
        }
        assertMode(value.current.mode)
      }
      return value
    },
  }
  return {
    key: MODE_PROJECTION_KEY,
    stateSchema,
    init: initialModeState,
    apply: reduceModeState,
    wire: {
      viewSchema: stateSchema,
      view: modeView,
    },
    stateVersion: 3,
  }
}

export function installModeProjection(ctx) {
  return ctx.sessionProjections.register(createModeProjectionDefinition())
}

export function createSelectionOperation(authority, resolveAgent) {
  return async function selectNextOperation(args) {
    const agent = await resolveAgent(args)
    return authority.selectMode(agent, args?.mode)
  }
}

export function createModeCommand(authority) {
  const selectNext = createSelectionOperation(authority, ({ agent }) => agent)
  return {
    name: MODE_COMMAND,
    description: 'Select Build or Plan for the next message',
    input: { hint: '<build|plan>' },
    async handler({ agent, rawInput }) {
      const outcome = await selectNext({ agent, mode: rawInput.trim().toLowerCase() })
      return { kind: 'success', text: `Next message mode: ${outcome.next}.` }
    },
  }
}

export function installModeCommand(ctx, authority) {
  return ctx.commands.register(createModeCommand(authority))
}

function frozenModeOf(authority, agent) {
  if (agent?.session === undefined) return BUILD_MODE
  if (isResearchChild(agent.session)) return PLAN_MODE
  return authority.view(agent.session).current?.mode ?? BUILD_MODE
}

function canPlanInterrupt(exec, agents) {
  if (exec.name !== CHILD_INTERRUPT_TOOL || agents === undefined) return false
  const targetId = exec.arguments?.agent_id
  return typeof targetId === 'string' && canInterruptResearchChild(exec.agent, targetId, agents)
}

export function createPromptSection(authority) {
  return {
    name: 'bplan:plan-guidance',
    order: 50,
    text(context) {
      return frozenModeOf(authority, context.agent) === PLAN_MODE ? PLAN_GUIDANCE : ''
    },
  }
}

export function installPromptAdapter(ctx, authority) {
  return ctx.systemPrompt.section(createPromptSection(authority))
}

export function createToolGuard(authority, agents) {
  return function enforceBuildPlanToolPolicy(exec) {
    const mode = frozenModeOf(authority, exec.agent)
    if (mode === PLAN_MODE && canPlanInterrupt(exec, agents)) return undefined
    const decision = policyFor({
      capability: 'tool',
      mode,
      name: exec.name,
      arguments: exec.arguments,
    })
    return decision.kind === 'delegate' ? undefined : decision.reason
  }
}

export function installToolPolicyAdapter(ctx, authority) {
  const agents = getOptionalService(ctx, 'agents')
  return ctx.tools.guard(createToolGuard(authority, agents))
}

function activationMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function reportActivation(ctx, diagnostic) {
  const packageVersion = getOptionalService(ctx, 'packageVersion')
  const reported = packageVersion === undefined ? diagnostic : { ...diagnostic, packageVersion }
  const reporter = getOptionalService(ctx, 'reportDiagnostic') ?? getOptionalService(ctx, 'onDiagnostic')
  if (typeof reporter === 'function') {
    try { reporter({ ...reported, half: 'host' }) } catch { /* optional diagnostics cannot fail startup */ }
    return
  }
  const logger = getOptionalService(ctx, 'logger')
  try { logger?.warn?.(`build-plan-mode host ${diagnostic.state}: ${diagnostic.reason}`) } catch { /* logging is best effort */ }
}

function getOptionalService(ctx, name) {
  if (Object.hasOwn(ctx, name)) return ctx[name]
  if (typeof ctx.get !== 'function') return undefined
  try { return ctx.get(name, false) } catch { return undefined }
}

const CORE_SERVICES = ['sessionProjections', 'systemPrompt', 'tools', 'commands']

function requiredContract(name, value) {
  if (name === 'sessionProjections') return typeof value?.register === 'function' && typeof value?.stateOf === 'function'
  if (name === 'systemPrompt') return typeof value?.section === 'function'
  if (name === 'tools') return typeof value?.guard === 'function'
  if (name === 'commands') return typeof value?.register === 'function'
  return false
}

function activateHost(ctx, provided = {}) {
  const required = Object.fromEntries(
    CORE_SERVICES.map((name) => [name, provided[name] ?? getOptionalService(ctx, name)]),
  )
  const capabilities = Object.entries(required)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name)
  const missing = CORE_SERVICES.filter((name) => !requiredContract(name, required[name]))
  if (missing.length > 0) {
    reportActivation(ctx, { state: 'incompatible', reason: `missing capabilities: ${missing.join(', ')}`, capabilities })
    return
  }

  const disposers = []
  const acquire = (register) => {
    const value = register()
    const dispose = typeof value === 'function' ? value : value?.dispose
    if (typeof dispose === 'function') disposers.push(() => dispose.call(value))
    return value
  }
  let rollbackTask
  let failureTask
  let failed = false
  const rollback = () => rollbackTask ??= drainDisposers(disposers)
  const fail = (error, state = 'failed') => {
    if (failureTask !== undefined) return failureTask
    failed = true
    failureTask = rollback().then((cleanupErrors) => {
      const reason = activationMessage(error)
      reportActivation(ctx, {
        state,
        reason: cleanupErrors.length === 0
          ? reason
          : `${reason}; cleanup failed: ${cleanupErrors.map(activationMessage).join('; ')}`,
        capabilities,
      })
    })
    return failureTask
  }
  try {
    const authority = createWorkflowConfiguration({
      readState: (session) => required.sessionProjections.stateOf(session, MODE_PROJECTION_KEY),
    })
    const install = (dependencies, activate) => {
      if (failed) return undefined
      return acquire(() => ctx.inject(dependencies, (injectedCtx) => {
        if (failed) return undefined
        try {
          return activate(injectedCtx)
        } catch (error) {
          const state = /conflict|exclusive|already registered/i.test(activationMessage(error)) ? 'conflict' : 'failed'
          return fail(error, state)
        }
      }))
    }
    install(['sessionProjections'], (projectionCtx) => installModeProjection(projectionCtx))
    install(['systemPrompt'], (promptCtx) => installPromptAdapter(promptCtx, authority))
    install(['tools'], (toolCtx) => installToolPolicyAdapter(toolCtx, authority))
    install(['commands'], (commandCtx) => installModeCommand(commandCtx, authority))
    if (!failed && getOptionalService(ctx, 'subagents') !== undefined) {
      install(['subagents'], (subagentCtx) => installResearchChildAdapter(subagentCtx, {
        authority,
        planMode: PLAN_MODE,
        policyFor,
        denial: PLAN_POLICY_DENIAL,
        guidance: `${PLAN_GUIDANCE}\n\nYou are a Research Child. Return only facts and recommendations to your direct parent. Do not author the final plan, create descendants, orchestrate work, mutate state, or control unrelated agents.`,
      }))
    }
    if (!failed && typeof ctx.effect === 'function') {
      ctx.effect(() => rollback, 'build-plan-mode activation')
    }
    return failureTask
  } catch (error) {
    const state = /conflict|exclusive|already registered/i.test(activationMessage(error)) ? 'conflict' : 'failed'
    return fail(error, state)
  }
}

export function apply(ctx) {
  const provided = Object.fromEntries(CORE_SERVICES.map((name) => [name, getOptionalService(ctx, name)]))
  if (CORE_SERVICES.every((name) => requiredContract(name, provided[name]))) return activateHost(ctx, provided)
  if (typeof ctx.inject !== 'function') {
    reportActivation(ctx, { state: 'incompatible', reason: `missing capabilities: ${CORE_SERVICES.filter((name) => !requiredContract(name, provided[name])).join(', ')}`, capabilities: [] })
    return
  }
  return ctx.inject(CORE_SERVICES, (injectedCtx) => activateHost(ctx, injectedCtx))
}

export default { name: 'build-plan-mode', apply }
