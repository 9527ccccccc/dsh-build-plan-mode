// Research Child Module (design §8, spec "Research Children", tests §13.4).
//
// This file is the global single authority for Research Child logic: index.js
// only imports from here. A Research Child is a first-level background
// continuable subagent whose direct parent had a frozen Plan Current at
// delegation. Classification runs synchronously in the continuable setup seam
// (before the child's first model/tool activity); success installs an
// agent-scoped monotonic tool guard and Research guidance, failure installs a
// no-op disposer.
//
// Child policy is fixed for the child's lifetime: later parent mode changes do
// not reclassify it. Cold resume re-runs setup and reconstructs classification
// from the live direct parent or the immutable seed prefix; no handoff
// registry or identifier is created. A child never reads model-selection
// services — its model routing stays ordinary DSH behavior.

import { drainDisposers } from './disposer-drain.js'
import { CHILD_NEVER_TOOLS } from './tool-taxonomy.js'

const researchChildren = new WeakSet()

export function isResearchChild(session) {
  return researchChildren.has(session)
}

// A Research Child's permanent prohibitions are the taxonomy's child
// never-set: everything outside the observation class, composed so a later
// relaxation of the parent Plan allowlist alone can never admit these tools
// for a child.
const CHILD_NEVER = new Set(CHILD_NEVER_TOOLS)

/**
 * Pure decision for one child tool execution. Delegates to the shared
 * Plan policy decision for everything except the child-only prohibitions
 * (no descendants, no orchestration, no agent control, no runtime mutation,
 * no shell, no explicit sandbox escalation).
 */
export function decideResearchChildTool(policyFor, planMode, denial, exec) {
  if (CHILD_NEVER.has(exec.name)) return denial
  const args = exec.arguments
  if (args !== null && typeof args === 'object' && args.sandbox_permissions !== undefined) return denial
  const decision = policyFor({
    capability: 'tool',
    mode: planMode,
    name: exec.name,
    arguments: exec.arguments,
  })
  return decision.kind === 'delegate' ? undefined : denial
}

export function createResearchGuard(policyFor, planMode, denial) {
  return (exec) => decideResearchChildTool(policyFor, planMode, denial, exec)
}

/**
 * Resolve the direct parent's frozen Current from the live agent registry or,
 * when the parent is not live (cold resume), from the child's immutable seed
 * prefix: the events inherited from the parent, whose length is recorded in
 * header.seedLength. The frozen Plan check must reproduce what the parent's
 * own log showed at delegation.
 */
export function resolveResearchParent(child, agents) {
  const parentId = child.session.header.parentSession
  if (parentId === undefined) return undefined
  const live = agents?.get(parentId)
  if (live !== undefined) return live
  const seedLength = child.session.header.seedLength
  if (!Number.isSafeInteger(seedLength) || seedLength < 1) return undefined
  const prefix = child.session.events.slice(0, seedLength)
  if (prefix.length === 0) return undefined
  return { session: { ...child.session, id: parentId, events: prefix } }
}

function parentFrozenPlan(child, agents, authority, planMode) {
  const parent = resolveResearchParent(child, agents)
  if (parent === undefined) return false
  return authority.view(parent.session).current?.mode === planMode
}

/**
 * Synchronous classification. Marks the child in process-owned classification
 * state only when its direct parent's frozen Current is Plan. Returns true on
 * success; a classified child is never reclassified (lifetime fixed).
 */
export function classifyResearchChild(child, agents, options) {
  if (isResearchChild(child.session)) return true
  if (!parentFrozenPlan(child, agents, options.authority, options.planMode)) return false
  researchChildren.add(child.session)
  return true
}

/**
 * Ownership-scoped interruption. Only the exact direct parent may interrupt
 * its own classified direct child: the target must be a direct child
 * (header.parentSession matches), must be classified, and must be owned by
 * the caller in the live agent registry.
 */
export function canInterruptResearchChild(parent, targetId, agents) {
  const target = agents?.get(targetId)
  if (target === undefined) return false
  if (target.session.header.parentSession !== parent.session.id) return false
  if (!isResearchChild(target.session)) return false
  return agents.isOwnedBy(targetId, parent) === true
}

/**
 * Install the child-owned monotonic guard and Research guidance into the
 * child's unpublished scope. Returns one disposer that releases both exactly
 * once in reverse installation order.
 */
export function installResearchRestrictions(childCtx, options) {
  const tools = childCtx.get('tools')
  const systemPrompt = childCtx.get('systemPrompt')
  const disposers = []
  try {
    if (tools !== undefined) {
      disposers.push(tools.guard(createResearchGuard(options.policyFor, options.planMode, options.denial)))
    }
    if (systemPrompt !== undefined) {
      disposers.push(systemPrompt.section({
        name: 'bplan:research-child',
        order: 51,
        text: () => options.guidance,
      }))
    }
  } catch (error) {
    // Contained drain; the returned promise is deliberately discarded. Every
    // disposer installed today is synchronous, so cleanup completes before the
    // rethrow/return below; a future thenable disposer would settle after it,
    // contained by the helper. Classification stays synchronous by design.
    void drainDisposers(disposers)
    throw error
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    void drainDisposers(disposers)
  }
}

/**
 * The continuable setup contribution: classify before first tool activity,
 * then install restrictions only on success. A failed classification (e.g. a
 * Build parent) returns a no-op disposer and installs nothing.
 */
export function createContinuableResearchSetup(agents, options) {
  return (childCtx) => {
    const child = childCtx.agent
    if (child === undefined || child.session === undefined) return () => {}
    return classifyResearchChild(child, agents, options)
      ? installResearchRestrictions(childCtx, options)
      : () => {}
  }
}

export function installResearchChildAdapter(ctx, options) {
  const agents = ctx.get('agents')
  if (agents === undefined) return () => {}
  return ctx.subagents.registerContinuableSetup(createContinuableResearchSetup(agents, options))
}
