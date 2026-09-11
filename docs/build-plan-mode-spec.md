# Build / Plan Standard Cordis Plugin

## Status and Authority

This document is the product-behavior authority for the Build / Plan standard plugin.

The accepted delivery target is DSH `0.1.5-rc.2`. The product has two explicit capability profiles:

- **rc2 Core** is the first release contract. It provides the Build/Plan workflow and conservative Plan read-only protection without changing DSH model selection.
- **Mode Model Memory Extension** is a later optional capability. It may activate only on a verified DSH release that exposes both official model-selection contracts required by the Host and Client.

The Core is useful and complete without the Extension. Absence of the Extension is not a Core activation failure.

## Problem Statement

DSH does not currently provide the required OpenCode-style Build/Plan workflow. A user cannot reliably choose, before sending a message, whether the next turn may mutate state or must remain observational. Native Plan state is step-oriented, its review flow can take over the composer, and it does not make delegated research read-only for the child's lifetime.

The immediate requirement is therefore a persistent, Session-scoped mode workflow with Host-enforced Plan restrictions. The longer-term product also wants an independent complete model selection for Build and Plan, but current DSH releases expose no public plugin seam that can safely own Session model selection or invalidate the existing Client model directory.

The plugin must not simulate that missing authority, wrap private `apiProxy.sessions.*` methods, replace shared Service methods, duplicate the model selector, or modify DSH core or its npm installation.

## Product Invariants

1. **Build identity.** Build preserves ordinary DSH tools, approvals, sandbox behavior, model selection, prompt routing, and conversation semantics.
2. **Plan protection.** Plan is Host-enforced read-only for tool-mediated files and arbitrary Harness runtime mutation. The only runtime-state exceptions are creation of the specified first-level background continuable Research Children and ownership-scoped interruption of those direct children. The claim is not absolute operating-system or network isolation.
3. **Session locality.** Every Session owns its own Next Message Mode. No browser-local or process-global mode is authoritative.
4. **Turn freeze.** Native `turn/start` freezes Current Turn Mode before inbox claim, prompt assembly, `agent/pre-step`, and the first model step. Current remains immutable until the matching `turn/end`.
5. **Queued changes.** A mode change after `turn/start` affects only the next turn. Host append order decides a send/switch race deterministically.
6. **Ordinary handoff.** A Plan Handoff is ordinary assistant content headed `执行计划`. It has no identifier, registry, projection, pending state, or lifecycle tools.
7. **Research lifetime.** A Research Child is classified before its first tool call and retains child-owned read-only policy for its lifetime, even if its parent later selects Build.
8. **Lifecycle ownership.** Every projection, guard, prompt section, command, child setup, Slot contribution, stylesheet, and keyboard listener is lifecycle-owned and reversible.
9. **Persistence compatibility.** Sessions written while the plugin is mounted remain loadable when it is absent. The plugin writes no unknown required Session event type.
10. **No false model state.** On rc2, the existing selector and `/model` keep ordinary DSH semantics. The Core never claims, displays, persists, or routes independent Build/Plan model memory.
11. **Atomic optional capability.** Mode-specific model memory is a deployment-level capability bundle. Host authority and Client invalidation are either both verified and enabled or the Extension is off.

## rc2 Core Behavior

### Mode state

The Host owns one durable **Next Message Mode** per Session:

```text
build | plan
```

A Session with no accepted plugin state defaults to Build. Selection through click, unmodified Tab on the main conversation surface, and `/bplan build|plan` reaches the same Host mutation operation.

The Host projection exposes:

```text
Next Message Mode
Current Turn Mode = null | { turn, mode }
revision
```

Current is derived from native turn events. It is not a second user setting.

### Build

A frozen Build turn adds no tool denial, prompt policy, sandbox override, model route, approval rule, or orchestration restriction. Selecting Build by itself performs no work.

When the user later sends a clear execution request in Build, ordinary conversation semantics apply. The Agent uses the latest message and current conversation, proceeds through minor in-scope adjustments, and asks one concise question only when the execution target is genuinely ambiguous. Scope-expanding or architecture-changing feedback returns to Plan.

### Plan

A frozen Plan turn:

- receives Plan guidance on every main-Agent model step;
- may inspect files, projections, images, web results, jobs, and agent status through an explicit reviewed observation allowlist;
- denies file writes, edits, Harness runtime mutation, approval escalation, workflow/Ralph/goal mutation, job cancellation, arbitrary agent control, and unknown tools before the tool body runs;
- may create only first-level background continuable Research Children through the supported subagent entry points;
- may interrupt only its own direct classified Research Child;
- cannot elevate itself to Build or claim execution.

DSH rc2 has no composable per-call sandbox-policy registration seam. Therefore the Core does not replace `sandboxPolicy.resolve` and does not claim to force an arbitrary shell into read-only mode. Shell, terminal, code execution, and other command interpreters are denied in Plan unless a later official monotonic sandbox adapter is separately designed and verified. Ambiguous capabilities fail closed.

A denied mutation returns a compact result that tells the Agent to continue available read-only investigation and still produce the best supported Plan Handoff.

### Plan Handoff

Plan returns an ordinary assistant message headed exactly `执行计划`.

For a practical small, low-risk request, it includes the complete proposed output when that is useful for review. For larger work it includes:

- goal;
- affected areas;
- intended change in each area;
- important interfaces and constraints;
- focused validation;
- rollback;
- instruction to select Build and send an execution request.

Native Plan Review and `exit_plan_mode` are not part of this workflow. The mounted composition must not expose a conflicting native Plan control or active native Plan policy for the same conversation surface.

### Research Children

Plan may start fresh-context and conversation-inheriting Research Children only as first-level background continuable subagents.

A Research Child:

- is synchronously classified from its direct parent's frozen Plan turn before first tool use;
- retains read-only restrictions for its lifetime;
- cannot create descendants, orchestrate work, mutate state, or control unrelated agents;
- returns facts and recommendations to its parent;
- does not author the final Plan Handoff;
- keeps ordinary DSH child-model routing.

Title generation, compaction, and other auxiliary model calls remain ordinary DSH behavior.

### Client behavior

The Build/Plan segmented control remains visible near the composer and is mode-only. Build and Plan have distinct text, icons, accessible pressed state, and green/amber signals without relying on color alone.

When idle, the UI emphasizes only Next. While a turn runs and Current differs from Next, it shows `Current <Mode> -> Next <Mode>`. It adds no status noise when they agree.

Unmodified Tab switches mode only on the main conversation surface. Shift+Tab, modifiers, IME composition, settings, menus, overlays, interaction panels, keyboard-managed surfaces, and non-conversation pages keep standard behavior. Composer text, selection, and focus are preserved.

The existing DSH model selector remains in its original location and keeps its native rc2 meaning. The Core does not require `ctx.modelDirectories.invalidate` and does not replace or duplicate the selector or `/model` command.

## Mode Model Memory Extension

### Activation contract

The Extension is off by default. It may be enabled only when all of the following are true:

1. the mounted plugin configuration explicitly requests it;
2. the installed DSH release is in a verified compatibility matrix containing both contracts;
3. Host exposes `ctx.sessionModelSelection.register` with the approved authority semantics;
4. Client exposes `ctx.modelDirectories.invalidate(sessionId)` with resident-only generation invalidation semantics;
5. focused Host, Client, persistence, routing, and lifecycle contract tests pass for that exact DSH release.

A Host-only or Client-only contract is not a degraded Extension. It is Extension-unavailable. The Core remains active and model behavior remains ordinary.

Runtime feature detection cannot create a distributed Host/Client transaction. Atomicity is therefore a package/release/composition guarantee backed by the compatibility matrix and acceptance tests, not a claim that two JavaScript realms commit simultaneously. A partial or mismatched deployment is an activation error requiring the Extension to be disabled and remounted.

### Extended behavior

When active, every Session independently remembers one complete Build model selection and one complete Plan model selection:

```text
{ provider, model, reasoningEffort? }
```

The selected mode determines what the existing selector and `/model` read and update. Existing Sessions initialize both selections from their ordinary Session selection. New Sessions initialize both from their ordinary starting selection. Initialization is persisted immediately and later global-default changes do not mutate it.

The Extension freezes mode and complete model selection atomically at prompt admission before enqueue. Every main-Agent step, continuation, steer, and retry in the turn uses that frozen selection. Mid-turn mode or model changes affect only Next. Research Children, title generation, compaction, and auxiliary calls retain ordinary routing.

Invalid or unavailable selections do not overwrite the previous accepted value. An unavailable selected mode remains visible and repairable, blocks only that mode's next prompt, and never silently falls back. The other mode remains usable.

The existing selector remains the sole model control. A mode switch invalidates only the already-resident directory, clears stale display synchronously, and reloads through the existing generation guard. `/model` and the composer selector continue to share the same directory. While a turn runs and Current mode/selection differs from Next, the status may show `Current <Mode> · <Model> -> Next <Mode> · <Model>`; it remains quiet when they agree.

### Extension rollback

Stopping the Extension restores ordinary DSH model authority only through the official registration disposer. It never restores method identities because it never replaces them. Mode-specific memory remains replayable for a later remount while the Session stays loadable without the plugin.

## User Stories and Acceptance Groups

### Core workflow

1. The user can see and select Build or Plan for the next message in every ordinary Session.
2. Mode is Session-scoped and survives refresh, Session switching, resume, fork, and cold restart.
3. A running turn retains the mode frozen at its native `turn/start`; a concurrent change queues for the next turn.
4. Multiple tabs converge on Host append order and never keep authoritative browser-local mode state.
5. Build preserves ordinary DSH behavior exactly.
6. Plan completes useful investigation while its reviewed Host guard denies mutation before tool bodies.
7. Plan shell, terminal, code execution, escalation, unknown tools, and ambiguous capabilities fail closed on rc2.
8. Plan returns an ordinary `执行计划` handoff and never invokes native Plan Review.
9. A Plan-side request to execute remains in Plan; selecting Build alone executes nothing.
10. Plan may create only supported first-level background continuable Research Children.
11. A Research Child remains read-only after its parent selects Build and cannot create descendants.
12. Only a direct owning Plan parent may interrupt its classified Research Child.
13. Click, Tab, and `/bplan` update the same Host state.
14. Keyboard exclusions, accessibility, focus preservation, responsive layout, light/dark themes, and lifecycle disposal pass GUI acceptance.
15. Stopping the plugin removes all runtime behavior; remount replays retained mode state.

### Optional model memory

These stories apply only when the Extension activation contract passes:

1. Each Session remembers independent complete Build and Plan selections, including provider and reasoning effort.
2. Existing and new Sessions initialize both mode selections from ordinary DSH behavior without changing the global default.
3. The existing selector and `/model` edit only the selected Next mode.
4. Mode switches never show the previous mode's model as current while reloading.
5. Invalid selection preserves prior state; unavailable selection is visible, repairable, and never silently substituted.
6. Prompt admission freezes mode and model together; every main-Agent continuation uses the frozen selection.
7. Forks inherit the configuration at the fork cut and then diverge independently.
8. Two tabs converge on the latest Host-accepted validated selection.
9. Research Children and auxiliary model calls retain ordinary DSH routing.
10. Stop/remount restores ordinary authority and later recovers retained mode memory without private wrapping.

## Testing Decisions

1. The Workflow Module Interface is the primary test surface. Reducer fixtures are used only for replay and compatibility cases that cannot be expressed through a live Session test.
2. Persistence tests cover accepted snapshot pairs, failed/incomplete pairs, revision ordering, Session isolation, fork cuts, replay, cold restart, plugin-absent loading, and legacy v2/ignorable-event compatibility.
3. Turn tests use native `turn/start` and `turn/end`; production code and tests do not call a synthetic public `claimTurn` operation.
4. Policy tests execute representative calls through `tools.guard`. They prove monotonic denial, denial-before-body ordering, Build identity, Plan allowlist behavior, escalation denial, shell denial, and unknown-tool denial.
5. Prompt tests prove frozen Plan guidance on every continuation and no Build prompt change.
6. Research lifecycle tests cover both subagent entry points, pre-first-tool classification, parent changes, cold replay, descendant denial, ownership-scoped interruption, and ordinary child-model routing.
7. Client tests cover projection absence, idle/running presentation, command failure, keyboard exclusions, one mode control, no model-directory requirement in Core, and exact disposal.
8. Activation tests cover transactional installation, reverse unwind, repeated stop/remount, optional-service absence, and diagnostics without taking down DSH.
9. Extension tests are a separate suite and run only against a verified dual-contract DSH release. They cover authority exclusivity, admission, routing, global-default isolation, Client generation invalidation, and deployment-level all-or-off acceptance.
10. GUI acceptance uses the existing DSH Web GUI at `http://127.0.0.1:3080`. Starting another server does not verify this product.
11. Focused plugin and affected Host/Client tests are allowed. Repository-wide build, lint, or tests require separate approval.

## Composition and Release Constraints

- Deliver one persistent standard Host-and-Client Cordis Plugin mounted once from the user Web profile, independently of Agent presets.
- Do not modify DSH core, its npm installation, Web shell, shipped presets, private DOM, generated classes, or persisted Session preset identity.
- Do not wrap private `apiProxy.sessions.*`, `agentDefaultModel.saveSelection`, `modelDirectories.directoryFor`, or shared `sandboxPolicy.resolve` methods.
- Before composition changes, inspect the exact user profile and resolve how native `plan-mode` and `ui-plan` contributions are disabled or isolated. If the composition cannot remove the conflicting workflow through public Cordis lifecycle, release is blocked.
- Treat plugin runtime stop and deployment rollback separately: stopping the plugin removes only plugin-owned effects; restoring native Plan requires restoring the original profile composition and restarting DSH.
- Build and deploy only affected plugin artifacts. Refresh the existing GUI for Web artifact changes.
- Verify controlled restart/remount, plugin stop, and profile rollback before acceptance.
- Keep the dynamic prototype available during development; stop, but do not undefine, it only after standard-plugin acceptance succeeds.

## Out of Scope

- Independent Build/Plan model memory on stock DSH rc2.
- A second model selector, a plugin-owned model catalog, or global-default mutation.
- Direct DSH source/npm installation modification or private method wrapping.
- A generic routing, capability, policy, transaction, keyboard-shortcut, fork, or handoff framework.
- Arbitrary shell access in rc2 Plan mode.
- Absolute OS, process, or network isolation.
- Foreground Research Children, descendants, workflow, or Ralph in Plan.
- Automatic Plan-to-Build switching or execution caused only by selecting Build.
- Persisted Plan Handoffs, identifiers, registries, review panels, or lifecycle tools.
- End-user documentation before implementation and acceptance are complete.
