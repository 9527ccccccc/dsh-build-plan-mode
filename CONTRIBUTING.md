# Contributing

Thanks for looking in. This is a small, single-maintainer plugin — the bar is: focused, tested, honest about scope.

## Development setup

Prerequisites: Node 18+ and a DSH `0.1.1-rc.2` Web install for live testing (unit tests alone need nothing else — the package has zero npm dependencies).

```powershell
npm run build   # assemble lib/ from src/ (required before testing; the freshness pin enforces it)
npm test        # focused suite — must stay green
```

`npm test` fails with a recovery hint if `lib/` is stale; rerun the build first. That is the whole loop.

## Ground rules

- **Tests enter through public interfaces.** No source-text regexes over `src/`, no reaching into reducer internals. Replay fixtures are allowed only for compatibility cases a live session cannot express.
- **The bundle stays standalone.** The client half is concatenated at build time and loaded by the DSH module loader — never add runtime imports across halves; shared knowledge rides build-time inlining (see `scripts/lib-roster.mjs`, `src/contract.js`).
- **Knowledge has one owner.** Wire identities live in `src/contract.js`, tool classification in `src/tool-taxonomy.js`, uninstall sequencing in `src/disposer-drain.js`, ship lists in `scripts/lib-roster.mjs`. Add facts beside their owners instead of re-spelling them.
- **Everything is lifecycle-owned and reversible.** Every listener, guard, Slot, style, and restriction must unwind through a disposer.
- **No DSH core modification, ever.** The plugin consumes public seams only; if a seam does not exist, fail closed or design around it — do not patch the host.

## Commit style

Conventional-ish one-liners matching the existing history: `feat(scope):`, `fix(scope):`, `refactor(scope):`, `test(scope):`, `docs:`, `chore:`.

## Proposing changes

Open an issue first for anything behavioral; PRs keep the focused suite green and update docs when behavior moves. Design-level changes should start from `docs/build-plan-mode-design.md` rather than diverging silently.
