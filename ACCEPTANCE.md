# Build / Plan Acceptance

Current acceptance status of the rc2 Workflow Core, against DSH **`0.1.1-rc.2`** (Web). Pre-rc2-adaptation evidence is archived in the project working records and is deliberately not repeated here.

## Method

Three evidence layers, in increasing fidelity:

1. **Focused suite** — `npm run build` then `npm test` from this package; zero runtime dependencies, runs on a fresh clone.
2. **Seam gate** — every public Cordis surface the plugin consumes was verified by quoting the installed `@deepseek-ai/*` rc.2 release bundles (ticket 01 gate record kept with the project archive).
3. **Live GUI + lifecycle** — the real Web profile at the real GUI, with controlled restarts timed by the operator across deployment rounds.

## 1. Focused suite

`113/113 passing`. Coverage includes: mode-state replay over synthetic event logs (v2/v3 snapshots and all legacy lanes through the public fold interface), Plan policy fail-closed matrix, monotonic guard semantics, Research Child classification/ownership/interruption, wire-contract uniqueness, generated-bundle artifact pins (standalone form, no model-selection references), byte-freshness of every verbatim lib copy, deploy identity mapping, and archive-independent toolchain behavior.

## 2. Seam gate — 8/8 verified

| Surface | Verdict |
| --- | --- |
| `ctx.tools.guard` — monotonic, denial before tool body | ✅ |
| `registerContinuableSetup` — synchronous setup before child's first activity, disposer-owned | ✅ |
| Native `command/run`+`command/done` records usable for plugin state (`bplan-state` is an open command name; no private event types written) | ✅ |
| `sessionProjections.register` with `stateSchema`/`wire`, `stateOf` fold | ✅ |
| `turn/start` ordering before prompt assembly | ✅ |
| Stock rc.2 exposes no model-selection contracts — Core correctly independent of them | ✅ |
| Profile patch layer may legally disable native `plan-mode`/`ui-plan` rows; rollback restores them | ✅ |
| No composable per-call sandbox seam exists on rc.2 — shell denial is the only honest conservative Plan policy | ✅ |

## 3. Runtime & lifecycle (live profile)

- Mounted once from the user Web profile composition; `--dump-config` shows exactly one `build-plan-mode` row and `ui-plan: disabled`.
- Click, <kbd>Tab</kbd>, and `/bplan build|plan` drive the same Host state; mode survives refresh, resume, fork, and session switch.
- Restart/remount verified with operator-timed controlled restarts during deployment rounds: persisted modes replay after restart; removing the composition rows and restarting restores native behavior; re-adding replays retained state.
- Hot removal (without restart) is **not** claimed on this DSH version: a running process keeps serving until its next controlled restart. Documented limitation, not a bug.
- Every listener, projection, guard, Slot, style, keyboard handler, and Research Child restriction is lifecycle-owned and unwinds in reverse installation order.

## Known limitations

- Pinned to DSH `0.1.1-rc.2`; any DSH upgrade invalidates the seam-gate record until re-verified.
- Exact model input/output/cache token counts are not exposed by the runtime and are reported as `N/A`.
- The optional Mode Model Memory Extension ships off and requires official DSH contracts that do not exist on this release.
