# Build / Plan Standard Plugin - Codebase Design

Product authority: `build-plan-mode-spec.md` (same docs directory).

Status: complete design for review. This document does not authorize implementation, profile composition changes, deployment, or restart.

Target runtime: DSH `0.1.1-rc.2` for the Core. The historical rc7 contract patches are evidence for a future Mode Model Memory Extension, not a prerequisite for the Core.

## 1. Design Result

Deliver one persistent standard Host-and-Client Cordis Plugin with two capability profiles:

```text
BuildPlanWorkflow Core                 always required on rc2
  + optional ModeModelMemoryAdapter    off on stock rc2
```

The Core is one deep vertical **Workflow Mode Module**. Its external Host Interface has two operations:

```ts
type Mode = 'build' | 'plan'

type ModeView = {
  revision: number
  next: Mode
  current: null | { turn: number; mode: Mode }
}

type SelectModeOutcome = {
  kind: 'changed' | 'noop'
  revision: number
  next: Mode
  applies: 'idle' | 'next-turn'
}

interface WorkflowMode {
  view(session: Session): ModeView
  selectMode(agent: Agent, mode: Mode): Promise<SelectModeOutcome>
}
```

`view` and `selectMode` are the only Core operations that Host callers and focused Interface tests learn. Persistence, replay, revision ordering, native-turn freeze, policy resolution, prompt guidance, Research Child lifetime, Client projection, keyboard routing, diagnostics, and disposal are Implementation behind this Interface.

The Mode Model Memory Extension does not add `selectModel` to the Core Interface. When it is enabled, it satisfies DSH's official `SessionModelSelectionAuthorityAdapter` Interface and uses the existing model-selection RPC Interface. Its Client half uses official `modelDirectories.invalidate(sessionId)`. The existing selector and `/model` remain callers of DSH, not callers of a plugin-owned model Interface.

A Plan Handoff remains ordinary conversation content. It is not Module state.

## 2. Design It Twice

The design pass framed one candidate: separate a legally distributable rc2 workflow from the model authority that stock rc2 does not expose, while preserving a clean future extension seam.

### 2.1 Constraints shared by every design

Any acceptable Interface must:

- activate the Core without `sessionModelSelection` or `modelDirectories.invalidate`;
- use only public lifecycle-owned Cordis seams;
- preserve ordinary Build behavior and ordinary rc2 model selection;
- freeze Current Mode from native turn order before the first step;
- make Plan denial monotonic and Host-enforced;
- remain loadable while the plugin is absent;
- keep model memory all-off unless both official contracts are verified;
- avoid generic capability, routing, persistence, transaction, and handoff frameworks.

Dependency classes are:

- reducer, equality, policy decision: in-process;
- Session log/projection, tools, commands, prompt sections, subagent setup: local-substitutable;
- future DSH Host selection authority and Host/Client projection transport: remote-but-owned;
- browser keyboard/rendering: true external runtime.

### 2.2 Design A: minimal snapshot authority

Interface: `view(session)` and `selectMode(agent, mode)`.

The Module appends complete versioned mode snapshots through known native command lifecycle records. Native `turn/start` and `turn/end` drive Current. Adapters receive the Module and install finished policy, prompt, command, child, and Client behavior.

Strengths:

- highest Leverage per operation;
- callers never construct persistence or freeze transitions;
- the same view serves prompt, guard, child classification, status, and tests;
- model semantics are absent from the rc2 Interface rather than represented as fake optional fields;
- deletion spreads replay and frozen-mode rules back across at least six callers.

Costs:

- the Implementation owns per-Session serialization and migration;
- complete snapshots repeat a few bytes;
- internal adapters still require careful lifecycle ordering.

### 2.3 Design B: extensible capability transaction

Interface: `read(session)` and `transact(agent, expectedRevision, operations[])`, with operations such as `set-mode`, `freeze`, `set-model`, `admit`, and `restore`.

Strengths:

- explicit compare-and-set and batching;
- could support more modes, policy dimensions, or third-party extensions.

Rejected:

- callers must learn revisions, operation ordering, partial failure, and retry rules;
- the product has a closed two-mode vocabulary;
- generic extension is explicitly out of scope;
- it exposes orchestration rather than hiding it, reducing Depth;
- the deletion test is poor because transaction machinery disappears instead of reappearing as domain complexity.

### 2.4 Design C: caller-first policy facade

Interface: `currentMode(agent)`, `nextMode(session)`, `policyFor(subject)`, `selectMode(...)`, and Client-oriented controller methods.

Strengths:

- each individual caller looks direct;
- custom policy consumers could branch on mode.

Rejected:

- it leaks the difference between live Next and frozen Current to every caller;
- exposing `policyFor` lets callers bypass or reimplement freeze semantics;
- browser loading concerns leak into the Host Module;
- tests cross internal state-machine and browser seams;
- policy vocabulary becomes a public generic capability engine.

Retained internally: one private frozen-mode selector and one private pure policy decision function.

### 2.5 Design D: Ports & Adapters core

Interface: a small workflow facade plus public ports for persistence, projection, policy, sandbox, child classification, model authority, and Client invalidation.

Strengths:

- dependency substitution is explicit;
- a combined future Host/Client capability is easy to describe;
- production and in-memory adapters can test remote-owned contracts.

Rejected as the external shape:

- Session projection, commands, and tools already provide local test substitutions; public ports would duplicate stable Cordis Interfaces;
- a public sandbox port is hypothetical on rc2 because no composable sandbox registration adapter exists;
- exposing ports makes composition and ordering caller knowledge.

Retained internally only where two adapters are real:

- future Mode Model Memory Extension over the official DSH model-authority and Client-invalidation contracts: one production Adapter and one in-memory contract-test Adapter, introduced only when the production contracts exist;
- Host/Client projection transport: existing DSH carrier and fixture Client Adapter.

### 2.6 Recommendation

Use A externally, with C's finished caller adapters and D's justified internal seams.

This hybrid has the best **Depth** because two Core operations exercise all workflow behavior. It has the best **Locality** because mode and freeze invariants stay in one Module, Plan enforcement stays in one internal policy, and model authority stays entirely in the optional Adapter. Its external **Seam** sits at the Host workflow decision point; Cordis and future DSH contracts remain internal integration seams.

Do not expose `currentMode()` or `policyFor()`. `view()` already provides the detached state needed for status and internal adapters. Direct policy access would make freeze correctness caller-owned.

## 3. Core State and Invariants

### 3.1 Projection state

```ts
type CoreProjectionState = {
  schema: 3
  revision: number
  next: Mode
  current: null | { turn: number; mode: Mode }
  pendingSnapshots: Record<string, DurableCoreSnapshotV3>
}

type DurableCoreSnapshotV3 = {
  v: 3
  revision: number
  next: { mode: Mode }
}
```

Core v3 has no generic contribution, admission, selection, or extension field. Adding placeholders for a hypothetical Adapter would make the Core a shallow configuration framework. If the Mode Model Memory Extension becomes real, it introduces and migrates to a dedicated v4 complete-configuration schema while preserving the external `WorkflowMode` Interface.

Current is never written into a durable snapshot. It is reconstructed from native `turn/start`/`turn/end` and the latest Next state at that event sequence.

### 3.2 Invariants

1. State is scoped to one Session. Browser state and process-global variables are never authoritative.
2. Empty history means `revision: 0`, Next Build, Current null.
3. Every accepted snapshot has a strictly increasing safe-integer revision.
4. A snapshot is authoritative only after its paired native `command/done` succeeds.
5. Incomplete, failed, malformed, older-revision, and unsupported-version snapshots do not change authoritative state.
6. `selectMode` changes only Next and preserves Current.
7. All state writes for one Session serialize through one queue keyed by Session identity, not Agent identity.
8. Host append order determines concurrent selection and send races.
9. Native `turn/start` freezes the latest Next mode at that exact sequence.
10. Duplicate or nested `turn/start` cannot replace an open Current.
11. Matching `turn/end` clears Current without changing Next.
12. Mode changes during an open Current affect only a later turn.
13. Returned views and selections are detached values.
14. Fork replay produces a copied state at the fork cut; later parent and child writes diverge.
15. The rc2 Core never reads, writes, aligns, persists, or displays a model selection.
16. Build policy always delegates.
17. Plan tool policy is monotonic: it may deny, never force-allow.
18. Unknown and ambiguous Plan capabilities deny.
19. Mode Model Memory Extension activation is profile-wide. A partial Host/Client contract is Extension-unavailable, not a degraded model-memory mode.

## 4. Workflow Mode Interface

### 4.1 `view(session)`

```ts
view(session: Session): ModeView
```

Behavior:

- validates a live ordinary Session;
- reads the registered projection state synchronously;
- returns a detached view;
- does not append, initialize, or repair state;
- throws a composition error if the projection Module is not registered;
- performs no model or sandbox operation.

Hot callers use `sessionProjections.stateOf(session, 'bplanMode')`. Replay fixtures may fold events directly through the same projection definition.

### 4.2 `selectMode(agent, mode)`

```ts
selectMode(agent: Agent, mode: Mode): Promise<SelectModeOutcome>
```

Ordering:

1. Validate the closed mode union and live ordinary Session.
2. Enter the per-Session write queue.
3. Read the latest projection state inside the queue.
4. Return `noop` without append when Next already equals `mode`.
5. Construct one complete v3 Core snapshot containing only the new revision and Next mode.
6. Append a paired known native `command/run`/`command/done` carrier synchronously.
7. Return only the committed projection revision.

`applies` is `idle` when Current is null and `next-turn` otherwise. It describes effect timing, not authorization to execute.

Errors:

- invalid mode: `TypeError` before append;
- missing/dead/nonordinary Session: composition or ownership error before append;
- append failure: exact error propagates, and no successful pair exists;
- projection/version invariant failure: hard activation/runtime diagnostic; no fallback fold or private mutation.

No optimistic Client state is committed. The Client waits for Host command settlement and projection push.

### 4.3 Caller examples

Command Adapter:

```ts
handler: async ({ agent, rawInput }) => {
  const result = await workflow.selectMode(agent, parseMode(rawInput))
  return { kind: 'success', text: `Next message mode: ${result.next}.` }
}
```

Prompt Adapter:

```ts
text: ({ agent }) =>
  frozenMode(workflow.view(agent.session)) === 'plan' ? PLAN_GUIDANCE : ''
```

Tool Guard Adapter:

```ts
ctx.tools.guard(exec =>
  planToolDenial(workflow.view(exec.agent.session), exec, researchOwnership)
)
```

Client callers do not receive the Host Interface directly. They consume the `bplanMode` wire projection and execute `/bplan` through the existing command channel.

## 5. Persistence and Replay

### 5.1 Durable carrier

DSH rc2 has no plugin event-type registration seam suitable for new required Session events. The Module therefore writes only known native command lifecycle records:

```ts
'command/run': {
  commandId,
  name: 'bplan-state',
  args: canonicalJson(snapshot),
  source: { kind: 'user' },
}
'command/done': {
  commandId,
  kind: 'success',
}
```

`bplan-state` is package-internal and is not advertised as a user command. `/bplan` has its ordinary command records; its handler delegates to `selectMode`, which appends the authoritative complete snapshot pair.

Snapshots are used instead of patches because replay, fork cuts, migration, revision ordering, and crash containment remain local. Removing the Module would otherwise spread reconstruction rules into every adapter.

Canonical JSON has stable property order, no `undefined`, and validates before append and replay. Command ids are process-unique and collision-resistant across resume.

### 5.2 Legacy replay

The projection accepts, in order of authority:

1. successful v3 `bplan-state` snapshot pairs;
2. successful v2 `bplan-state` snapshots, mapping only `next.mode` and revision into Core state and ignoring model fields; a future Extension migrator reads those fields from the original Session log rather than storing them in Core state;
3. successful historical `/bplan build|plan` command pairs before the first accepted snapshot;
4. already-migrated ignorable `bplan/next-selected` and `bplan/turn-frozen` records for historical replay only.

New code writes no `bplan/*` event type and no v2 snapshot. A first v3 write supersedes legacy mutation input without deleting history.

### 5.3 Projection definition

The rc2 registration must use the exact public contract:

```ts
{
  key: 'bplanMode',
  stateSchema,
  init: () => initialState(),
  apply: reduce,
  wire: {
    viewSchema,
    view: state => detachedModeView(state),
  },
  stateVersion: 3,
}
```

The current implementation's top-level `schema` and `view` shape does not match rc2's emitted `ProjectionDefinition`; implementation must replace it with `stateSchema` and `wire` rather than preserve the test double.

The reducer returns the same state reference for unrelated events so projection push performs no unnecessary work.

## 6. Native Turn Freeze

rc2 appends `turn/start` before inbox claim, system prompt assembly, `agent/pre-step`, and `step/start`. That committed event is the Core freeze seam.

For a Core-only turn:

```text
latest accepted Next at turn/start sequence
  -> Current { turn, mode }
  -> immutable until matching turn/end
```

No production `claimTurn()` method exists. Tests append native turn events or run the real loop. This prevents a caller from fabricating lifecycle state.

A send and a mode change may arrive concurrently. The event log resolves the race:

- snapshot done before `turn/start`: the new mode becomes Current;
- snapshot done after `turn/start`: Current keeps the old mode and Next changes;
- failed/incomplete snapshot: it has no effect.

Cold persistence preparation uses DSH's standard interrupted-turn repair. A fully written crash-tail `turn/start` receives the native synthetic interrupted `turn/end`, so projection replay clears Current without a plugin stale-turn registry. A live open turn remains live and is not repaired underneath its Agent.

A future Extension may reserve one admission token before Host enqueue through its official authority seam. That token belongs to the Extension's dedicated v4 complete-configuration schema and per-Session queue, not to Core v3. It is consumed by `turn/start`; mode/model changes carry it forward unchanged, and failed enqueue clears only the token created by that admission. Stock rc2 Core never creates an admission.

## 7. Plan Enforcement Module

### 7.1 Public enforcement seam

Use `ctx.tools.guard`, not direct shared-Service mutation and not an allow-capable pre-execute waterfall.

rc2 defines guards as monotonic checks after all `tools/pre-execute` listeners and before the tool body. Returning a reason denies; returning `undefined` cannot reverse another denial. The registration returns an exact disposer.

The private decision Interface is:

```ts
type PlanDecision = { kind: 'delegate' } | { kind: 'deny'; reason: string }

function decidePlanTool(
  mode: Mode,
  execution: Readonly<ToolExecution>,
  ownership: ResearchOwnership,
): PlanDecision
```

It is an internal Seam for pure tests, not a public capability engine.

### 7.2 Reviewed Plan allowlist

The Core may delegate only reviewed observational tools, including:

- file and image reads;
- glob/grep and projection inspection;
- web search;
- skill and goal reads;
- job output/list and agent list;
- supported background continuable `subagent` and `subagent_fork` creation;
- ownership-checked interruption of the parent's direct Research Child.

The exact list is code-reviewed against the runtime tool directory and tested as a closed set. An unlisted tool denies. Classification is declared once in the package's tool taxonomy module; the parent allowlist and the child prohibitions both derive from those named classes, so admission of a future tool is a one-place decision.

Plan denies:

- write/edit and filesystem mutation;
- Cordis define/run/stop/undefine and arbitrary Harness runtime mutation; the only runtime-state exceptions are the specified Research Child creation and ownership-scoped direct-child interruption paths;
- goal mutation, workflow, Ralph, job kill, arbitrary message/control operations;
- foreground or noncontinuable child creation;
- descendants and orchestration from Research Children;
- any explicit sandbox escalation argument;
- `pwsh`, bash, terminal, `run_code`, and other command interpreters on stock rc2;
- unknown or ambiguous capabilities.

### 7.3 Why shell is denied on rc2

`SandboxPolicyService.resolve()` is a public read operation, not a registration seam. Replacing its method is shared-Service mutation and is rejected.

rc2 also exports `setSandboxMode(session, 'read-only')`, but using it as a transient Plan adapter is rejected for the Core:

- it appends persistent Session policy, rather than composing one turn-local decision;
- a Session with no prior override cannot be restored to "no override" through that Interface;
- restoring the deployment default as an explicit override changes future ordinary Build semantics;
- approved explicit mode overrides outrank the Session fold;
- arbitrary shell commands can mutate Harness/runtime state outside file-sandbox coverage.

Therefore shell denial is the only honest conservative rc2 policy. A future official monotonic per-call sandbox adapter may add read-only shell as a separately designed capability without changing the Workflow Mode Interface.

### 7.4 Prompt guidance

One lifecycle-owned `systemPrompt.section` renders Plan guidance from frozen Current on every main-Agent step. It renders empty for Build, auxiliary contexts, and absent Current.

Guidance requires useful investigation and ordinary `执行计划` output, forbids native Plan Review and self-elevation, and explains denial recovery. Enforcement does not rely on the prompt.

The tool guard and prompt apply to tool executions and model-step assembly. DSH auxiliary work such as title generation and compaction is model-bound and does not execute tools, so it does not traverse the guard; it retains ordinary routing. If a later DSH revision runs tool-capable auxiliary agents against a Session whose Current is frozen Plan, the exact agent scope must be re-verified before release so auxiliary tools are not over-denied or under-denied.

## 8. Research Child Module

Both supported subagent entry points remain available only for background continuable first-level children during frozen Plan.

The continuable setup Adapter:

1. runs before the child's first model/tool activity;
2. identifies the direct parent from the live agent registry or seeded parent prefix;
3. verifies the parent's frozen Current was Plan at delegation;
4. marks the child in process-owned classification state;
5. installs an agent-scoped monotonic tool guard and Research guidance;
6. returns one disposer owned by the child's lifecycle.

Child policy is fixed for its lifetime. Parent changes do not reclassify it. Resume re-runs setup and reconstructs classification from the live parent or immutable seed prefix; no handoff registry is added.

A child cannot delegate, create descendants, orchestrate, mutate, or interrupt agents. The parent may interrupt only a direct child that is classified and ownership-checked by the agent registry.

Research Children never read optional mode-model selections. Their model routing remains ordinary DSH behavior.

## 9. Client Module

### 9.1 Core profile

The Client Core requires React, the public Slots runtime, projection hooks, and the existing command remote. It does not require `modelDirectories`.

It installs:

- one Build/Plan segmented control in the approved conversation input Slot;
- one Current-to-Next status contribution;
- one scoped stylesheet;
- one keydown listener with conversation/IME/modifier/overlay exclusions.

The control renders only Host projection state. Click and Tab execute `/bplan build|plan`; they do not mutate durable local state. Pending command state may disable the buttons temporarily, but projection push remains authoritative.

Projection absence means capability unavailable, not Build. This distinguishes an unmounted Host from a real default-Build Session.

### 9.2 Native Plan composition conflict

Stock rc2 may mount `@deepseek-ai/dsh-plan-mode` and `@deepseek-ai/dsh-client-ui-plan`, which own `/plan`, `plan:policy`, `exit_plan_mode`, and a competing `conversation.input.plan` contribution.

The Build/Plan product cannot claim a single ordinary-chat workflow while both controls/policies are active. Before profile modification, implementation must inspect the exact composition using the composition skill and choose a public lifecycle composition that disables or isolates the native Plan Host and Client contributions.

Acceptance requires:

- exactly one Build/Plan control on the conversation surface;
- no active native `plan:policy` in a plugin Plan turn;
- no executable native `exit_plan_mode` path from plugin Plan;
- ordinary non-Plan DSH behavior after the plugin Fiber stops;
- complete native Plan restoration after deployment rollback restores the original profile composition and restarts DSH.

Runtime stop and deployment rollback are distinct. A plugin disposer removes only plugin-owned effects; it cannot remount native Plan rows excluded by the profile composition. If the user profile cannot express legal isolation and reversible restoration without modifying shipped code, release is blocked and returns to design. Private DOM hiding is not an alternative.

### 9.3 Extension profile

When the deployment-level Extension profile is active, the Client adds one projection-driven effect that calls official `modelDirectories.invalidate(sessionId)` only when Next mode or that mode's remembered complete selection changes.

It establishes a baseline without invalidating. Invalidation clears stale display synchronously and reloads through the existing directory generation. The original selector and `/model` retain identity and share one directory.

When the Extension is off, this effect is absent and the selector keeps ordinary rc2 semantics.

## 10. Mode Model Memory Extension

### 10.1 Profile activation

Configuration is explicit:

```ts
type ModelMemoryProfile = 'off' | 'required'
```

`off` is the rc2/default profile. It installs no Host authority, Client invalidation, model state, routing adapter, admission token, or model status.

`required` is legal only for an exact DSH release listed in the plugin's verified compatibility matrix and exposing both approved contracts. Feature detection confirms emitted runtime shape; it does not substitute for the version matrix and focused contract tests.

Host and Client run in different realms, so JavaScript feature detection cannot form a distributed transaction. "Atomic bundle" means:

- one package version and one composition setting select the profile;
- the compatibility matrix guarantees both contracts in that DSH release;
- either half missing is an Extension activation error;
- no unsupported partial profile is advertised;
- deployment acceptance verifies both halves before the profile is released.

The Core remains a valid rollback target. Operators disable `required` and remount if a mismatched deployment is detected.

### 10.2 Adapter shape

The Host Adapter satisfies the approved DSH authority Interface:

```ts
interface SessionModelSelectionAuthorityAdapter {
  initialize(agent, ordinary): Promise<void>
  selection(agent, use: 'directory' | 'assembly', ordinary): ModelSelection
  select(agent, requested, ordinary, signal?): Promise<ModelSelection>
  admit(admission, ordinary): Promise<unknown>
}
```

It upgrades persistence to the dedicated v4 complete-configuration schema so mode and selection admission share one token and one per-Session queue. It migrates Core v3 and historical v2 records deterministically and does not add model methods to `WorkflowMode`.

The Client Adapter uses only:

```ts
modelDirectories.invalidate(sessionId): void
```

Direct wrapping of `apiProxy.sessions.*`, `agentDefaultModel.saveSelection`, `directoryFor`, concrete directory methods, or model selector Slots remains prohibited.

### 10.3 Extended state and behavior

The active `ModeModelMemoryAdapter` upgrades the same Module to one complete v4 state:

```ts
type WorkflowConfigurationV4 = {
  v: 4
  revision: number
  next: {
    mode: Mode
    build: ModelSelection
    plan: ModelSelection
  }
  admitted?: { token: string; mode: Mode; selection: ModelSelection }
}
```

This is not a second model state beside Core mode state. One reducer and one per-Session queue own the complete v4 configuration. The Host `WorkflowMode.view()` Interface remains mode-only; under the Extension, the `bplanMode` wire presentation additionally carries detached Build/Plan selections and Current's frozen selection for selector invalidation and differing Current-to-Next status. Stable identifiers are always available; catalog display names are presentation-only and never durable state.

Initialization, exact validation, unavailable-route behavior, prompt admission, main-Agent routing, fork inheritance, global-default isolation, Client invalidation, and rollback follow the optional Extension contract in `dsh-session-model-selection-contract-design.md`.

A missing provider is retained and repairable; it blocks only admission for the selected mode. No fallback or silent substitution occurs. Auxiliary and child routing remains ordinary.

### 10.4 No partial model semantics

The following are forbidden:

- persisting per-mode selections while the Client still shows one ordinary directory;
- changing selector meaning without invalidation;
- showing mode-specific model labels without Host authority;
- installing only request routing or only `/model` adaptation;
- fake browser-local memory;
- treating one detected contract as "partial support".

## 11. Dependency Classification

| Dependency | Category | Design treatment |
|---|---|---|
| Mode reducer, snapshot validation, equality, policy decision | In-process | Private pure implementation; direct tests only for replay edge cases |
| Session log and projection registry | Local-substitutable | Real Cordis test context and in-memory Session; no public port |
| Commands, tools.guard, systemPrompt.section | Local-substitutable | Existing public Cordis Interfaces with fixture adapters |
| Agent events and continuable child setup | Local-substitutable | Real scoped test context plus deterministic registry fixture |
| Host-to-Client projection frames | Remote-but-owned | Existing DSH carrier and fixture Client adapter; no new wire bus |
| Browser Slots, keyboard, rendering | True external runtime | Thin Client adapters, pure routing tests, GUI acceptance |
| Future Session model-selection authority | Remote-but-owned | Official DSH port with production and contract-test adapters |
| Future model-directory invalidation | Remote-but-owned | Official Client operation with production and generation test adapters |
| Sandbox policy resolve/session override | Local-substitutable but noncomposable for this use | Read only for diagnostics; no adapter, no shared mutation; shell denied |
| Plugin artifact/profile/restart | Deployment | Build and lifecycle acceptance, not the Module Interface |

No public persistence port, sandbox port, capability engine, model catalog, fork registry, or handoff registry is justified.

## 12. Lifecycle and Activation

Core Host activation is transactional:

1. Probe required Core services and exact callable contracts.
2. Register the projection first so every later adapter can read authoritative state.
3. Construct `WorkflowMode` over the registered projection and per-Session queues.
4. Register prompt section.
5. Register global monotonic tool guard.
6. Register `/bplan` command.
7. Register continuable Research Child setup.
8. Publish healthy Core diagnostics.

Client activation is independently transactional:

1. Probe Slots, projection hooks, command remote, React, and styles.
2. Verify native Plan composition preconditions.
3. Register mode Slot, status Slot, styles, and keyboard listener.
4. Under `required`, verify and install model-directory invalidation.
5. Publish healthy Client diagnostics.

Every acquired disposer enters one LIFO stack immediately. Any failure unwinds the acquired subset in reverse order and reports contained diagnostics. Diagnostics must not crash DSH.

Stop order:

1. stop accepting new mode/Extension operations;
2. drain per-Session queues and active optional authority operations;
3. dispose Client effects and higher-level Host adapters;
4. dispose Research Child setup for new children while existing child-owned scopes unwind with their owners;
5. dispose prompt, guard, command, and projection registrations in dependency-safe reverse order;
6. under the Extension, unregister official model authority last after its own drain.

Core stop requires no sandbox or model restoration because Core never mutated either. Durable command records remain harmless and replayable.

Repeated stop and remount are idempotent. Partial activation never leaves a shared method wrapper because no method is replaced.

## 13. Highest-Seam Focused Tests

### 13.1 Workflow Interface and persistence

1. Empty Session returns Build, null Current, revision zero.
2. `selectMode` validates input, noops without append, and reports `idle`/`next-turn` correctly.
3. Accepted snapshots are complete, paired, canonical, and revision-monotonic.
4. Failed/incomplete/malformed/older snapshots do not commit.
5. Concurrent writes serialize per Session; different Sessions proceed independently.
6. Replay, projection checkpoint invalidation, cold restart, and remount reproduce state.
7. The Session cold-loads with the plugin absent.
8. New code writes no `bplan/*` event type.
9. v2 snapshots and migrated legacy events map to Core mode without activating model memory.
10. Latest and historical fork cuts inherit then diverge.

### 13.2 Turn freeze

1. Native `turn/start` freezes the latest accepted mode at its sequence.
2. A later selection changes Next only.
3. Duplicate start cannot refreeze Current.
4. Only matching `turn/end` clears Current.
5. Completed, failed, cancelled, blocked, and disposed turns all clear through ordinary end events.
6. Real loop integration proves start precedes inbox claim, prompt assembly, pre-step, and first tool/model work.
7. Cold interrupted-turn repair appends the native synthetic end and clears replayed Current; a live open turn is not repaired.
8. No production or test caller uses a public synthetic claim operation.

### 13.3 Plan policy and prompt

1. Build delegates every representative tool unchanged.
2. Plan reviewed reads reach downstream policy/body.
3. Plan writes, runtime mutation, escalation, shell, code execution, and unknown tools deny before body.
4. A later pre-execute listener cannot undo guard denial.
5. Mid-turn Next Build cannot weaken frozen Current Plan.
6. Prompt guidance renders on every Plan continuation and never in Build.
7. Denial guidance supports continued investigation and ordinary handoff.
8. No code assigns to `sandboxPolicy.resolve` or calls `setSandboxMode` as a turn adapter.

### 13.4 Research lifetime

1. Both background continuable entry points classify before first tool use.
2. Foreground/noncontinuable children deny.
3. Parent mode changes do not alter child policy.
4. Resume reconstructs classification from live parent or seed prefix.
5. Child mutation, shell, descendants, orchestration, and unrelated interruption deny.
6. Exact direct-parent interruption succeeds.
7. Child model routing remains ordinary.
8. Child scope disposal removes its guard and guidance exactly once.

### 13.5 Client Core

1. Projection absence renders unavailable; empty Host history renders Build.
2. Exactly one plugin mode control and one quiet status contribution exist.
3. Click and Tab execute the same `/bplan` command path.
4. Shift+Tab, modifiers, IME, settings, menus, overlays, managed surfaces, and non-conversation pages preserve defaults.
5. Focus, selection, and composer text survive switching.
6. Core activation succeeds without `modelDirectories.invalidate`.
7. The original selector and `/model` behavior do not change.
8. Installation failure and stop dispose Slots, styles, and listeners once.
9. Desktop/mobile and light/dark GUI screenshots show no overlap or stale status.

### 13.6 Composition and lifecycle

1. Core service absence reports incompatible without partial installation.
2. Failure at every acquisition point unwinds in reverse order.
3. Stop/remount twice leaves one projection, command, guard, prompt section, child setup, and Client contribution.
4. Existing native Plan control/policy conflict is detected in the actual profile before release.
5. Controlled restart remounts the standard plugin and replays mode.
6. Controlled removal plus restart restores ordinary DSH and removes all UI/policy behavior.
7. The dynamic prototype remains stopped but defined only after acceptance.

### 13.7 Optional Extension

Run only against an exact verified dual-contract DSH release:

1. `off` installs zero model-memory behavior even when contracts exist.
2. `required` rejects either missing contract and never wraps internals.
3. Ordinary default adapter behavior remains unchanged with no custom authority.
4. Initialization persists complete mode selections without changing global default.
5. Selector and `/model` mutate only selected Next mode.
6. Admission freezes mode and model together before enqueue; failure clears only its token.
7. Every main-Agent continuation uses Current; children and auxiliary calls remain ordinary.
8. Directory invalidation is resident-only, synchronous-clear, generation-safe, and identity-preserving.
9. Stop drains authority and returns to ordinary behavior through the official disposer.
10. Deployment acceptance proves both Host and Client halves before advertising the profile.

Run focused plugin and affected Host/Client tests only. Full repository verification requires separate approval.

## 14. Deletion Test and Trade-offs

Deleting the Workflow Mode Module would reintroduce mode validation, event pairing, replay, Current freeze, detached views, and race semantics into the command, prompt, guard, child, and Client callers. The Module earns its keep and is deep.

Deleting the old sandbox wrapper removes complexity without forcing it elsewhere because rc2 has no legal turn-local adapter. It was pass-through shared mutation and must be deleted, not layered under a new guard.

Deleting the Mode Model Memory Extension removes only optional behavior; the Core remains coherent. That is intentional. The extension earns its own future module only when the two official DSH contracts provide real variation and focused contract tests.

Chosen trade-offs:

- Plan loses arbitrary shell inspection on stock rc2 in exchange for an honest Host-enforced read-only claim.
- Complete snapshots repeat small values in exchange for local replay and migration.
- A deployment compatibility matrix is stricter than opportunistic feature detection, but prevents unsupported half-model semantics.
- Native Plan composition may require profile surgery through public Cordis composition; if that cannot be expressed legally, release waits.
- The Core does not anticipate more modes or third-party policies; the closed product vocabulary keeps the Interface deep.

## 15. Migration from the Current Implementation

Implementation must replace, not layer over, the contract-dependent path:

1. Split activation into Core requirements and optional Extension requirements.
2. Make Core activation independent of `sessionModelSelection`, `llm`, `agentDefaultModel`, and `modelDirectories.invalidate`.
3. Replace the current projection definition with rc2's exact `stateSchema` plus `wire` contract and bump state version.
4. Introduce the v3 mode snapshot carrier and v2/legacy replay mapping.
5. Remove public/production `claimTurn`; freeze only through native turn events.
6. Reduce the external Module Interface to `view` and `selectMode`.
7. Replace `tools/pre-execute` policy installation with monotonic `tools.guard`.
8. Remove `pwsh` from the Plan allowlist and deny every shell/terminal/code interpreter.
9. Delete `installSandboxPolicyAdapter`; do not call `setSandboxMode` for turn-local policy.
10. Keep prompt guidance and Research Child behavior but make both consume the new frozen view.
11. Make Client Core install without model-directory invalidation and remove model keys/status from Core rendering.
12. Put all model-memory state, authority, routing, admission, invalidation, and rollback under `modelMemory: 'required'`.
13. Inspect and resolve native Plan Host/Client composition before mounting the standard plugin.
14. Replace old tests at the new highest Interface seam; retain reducer fixtures only for compatibility replay.
15. Build and run focused tests, then mount only after explicit implementation approval.
16. Verify the existing GUI, controlled restart/remount, and stop/rollback before acceptance.

The existing 63 passing tests are useful historical evidence but are not acceptance for this design. Tests that assert direct sandbox method replacement, rc7 authority as a Core requirement, model-directory invalidation as a Client Core requirement, or synthetic claim operations must be replaced.

## 16. Implementation Order

After explicit implementation approval, first pass the **seam verification gate** by running against the real installed rc2 runtime:

- `ctx.tools.guard` exists, is monotonic, runs after every `tools/pre-execute` listener, and executes before the tool body;
- a public setup seam runs before a continuable child's first tool activity and returns a child-owned disposer;
- a plugin can append known native `command/run`/`command/done` pairs and Session replay does not reject the internal `bplan-state` command name;
- `sessionProjections.register` accepts `stateSchema`/`wire` and `stateOf` returns the folded state;
- `turn/start` is appended before inbox claim, prompt assembly, `agent/pre-step`, and `step/start`;
- stock rc2 exposes neither model-selection contract (re-inspect exact target release, not only package versions);
- the user Web profile patch can legally disable or isolate native `plan-mode`/`ui-plan` contributions and restore them by profile rollback.

A gate failure is a concrete contradiction: stop and return to design, do not layer workarounds.

Then:

1. Load `cordis-plugin-development` and re-inspect exact rc2 Services, Events, commands, Slots, and lifecycle contracts.
2. Implement the v3 projection and replay compatibility first.
3. Implement the two-operation Workflow Mode Interface and per-Session serialization.
4. Add native turn freeze and persistence/fork/cold-load tests.
5. Implement monotonic Plan guard and remove shared sandbox mutation.
6. Adapt prompt guidance and Research Children.
7. Implement the Core Client without model-directory dependency.
8. Load `editing-cordis-compositions`, inspect the actual user Web profile, and resolve native Plan conflicts without modifying shipped code.
9. Run focused Core Host/Client tests.
10. Build and deploy only affected plugin artifacts.
11. Verify the existing GUI at `http://127.0.0.1:3080` after refresh.
12. Perform controlled restart/remount and stop/rollback acceptance.
13. Stop, but do not undefine, the retained dynamic prototype only after acceptance succeeds.

The optional Extension is a later phase triggered by an official compatible DSH release. It is not part of rc2 Core implementation tickets.

## 17. Addendum: Wire Contract Module (2026-08-25)

Adopted via the C1 deepening candidate (architecture-review-2026-08-25.md) after a three-way design-it-twice review; recorded here so the module-design authority stays complete.

**Module.** One pure-data contract module is the sole spelling site for four cross-runtime wire identities, grouped as `projection` (subscription key `bplanMode`, DOM marker attribute `data-bplan-mode`) and `commands` (interactive name `bplan`, state snapshot name `bplan-state`). Deeply frozen, JSON-safe, identity strings only — no functions, no shapes.

**Seam and adapters.** Two real adapters satisfy one interface: the Host half imports the module natively (ESM), while the build script serializes it — guarded by a structural JSON round-trip check against the contract object itself — into the generated client bundle through an anchored replacement of the single contract-import line, throwing on any surviving relative or dynamic import. A verbatim copy among built outputs lets the copied Host half resolve natively. Helper modules shared by both halves (the disposer-drain module) follow the same pattern: a verbatim lib copy for native Host resolution plus build-time inlining into the standalone client bundle through an anchored import-line replacement.

**Consumers.** Both halves derive their pre-existing exported names from the contract as thin aliases, so every caller and test surface stands still; the client composes interactive command dispatches and renders the marker attribute from contract values; the state-command id namespace is composed from the alias rather than hand-spelled.

**Verification.** Artifact-level agreement assertions extend the built-artifact-text precedent: the bundle must embed the exact serialized contract, stay free of relative imports, and match a verbatim contract copy; source scans forbid raw spellings of the four identities outside the module, exempting compound single-site namespaces such as legacy `bplan/*` event types and the prompt-section prefix.

**Rejected with reasons.** Runtime injection through the activation bag (demotes compile-time identity to runtime configuration and pollutes every test fixture); a contract version field (both halves regenerate atomically per build, so no mismatch is representable); admissions lacking two live agreeing sites (client slot names, Cordis event names, the rc2 outcome-shape convention).
