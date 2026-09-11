<!-- SPDX-License-Identifier: MIT -->

# Changelog

All notable changes to this project will be documented here.

## 0.1.1 - 2026-09-11

- Support DSH `0.1.5-rc.2`: the Host folds the session log through `snapshotEvents()`, which replaced the `events` array removed in that release. Both shapes fold identically, so `0.1.1-rc.2` keeps working.
- Composer control restyled onto native composer chrome — ghost pill, host icon grid, theme alias tokens — with one sliding tint that eases non-linearly between modes while its colour fades green → amber; `prefers-reduced-motion` disables the transition.
- Focused suite extended to both live Session shapes: `116/116`.

## 0.1.0 - 2026-08-26

- Initial public-source preparation of the rc2 Workflow Core.
- Persistent per-Session Build and Plan modes; Current Turn Mode frozen at `turn/start`.
- Host-enforced read-only Plan policy with fail-closed tool classification, and read-only first-level Research Children.
- Web composer mode control (click / Tab / `/bplan`), quiet status line, accessible and theme-aware.
- Single wire-contract, tool-taxonomy, disposer-drain, lib-roster, and deploy-identity owners; standalone client bundle assembled by a dumb build splicer.
- Focused suite: lifecycle, replay (including legacy `bplan/*` lanes), artifact pins, byte-freshness, and deploy-path tests.
