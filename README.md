# Build / Plan Mode (DSH plugin)

A persistent Cordis Host-and-Client plugin for [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) that adds a Build / Plan mode control to every session:

- **Build** — ordinary DSH behavior. Tools, sandbox, and approvals are exactly stock.
- **Plan** — Host-enforced read-only for the current turn. Useful observation stays available; file writes, shell/terminal/code execution, escalation, and unknown tools are denied before they run, and the agent finishes the turn with an ordinary written plan handoff that you review and execute in Build.
- Mode is persisted per session (survives refresh, resume, fork, and restart) and frozen for the duration of a running turn. Click, <kbd>Tab</kbd>, and `/bplan build|plan` drive the same Host state.
- Plan turns may spawn read-only background Research Children; everything else stays first-level and untouched.

**Status:** alpha — single-maintainer project, actively developed. The plugin mounts once from your Web profile composition and applies to all sessions independently of Agent presets. It does not modify DSH core, the npm installation, the Web shell, or shipped presets — it is pure user-layer composition.

## Requirements

- **DSH `0.1.5-rc.2` (Web).** Verified against this release (`ACCEPTANCE.md`). The Host reads the session log through both host shapes, so `0.1.1-rc.2` keeps working; any newer release invalidates the record until the seam gate is re-verified.
- An existing Web profile (for example the default `web` profile at `~/.dsh/profiles/web`).

## Install

### From a local checkout

In the directory that contains this package:

```powershell
dsh plugin --profile web add ./packages/build-plan-mode
dsh --profile web --dump-config
```

Restart DSH afterwards. The package ships its own bundle patch (`cordis.patch.yml`) which:

1. inserts the plugin row (`id: build-plan-mode`);
2. disables the native `ui-plan` client row so the built-in Plan control does not render twice.

If you manage the profile manually instead of using `dsh plugin`, install the dependency into the profile, add the package name to `dsh.profile.bundles` in the profile's `package.json`, and restart — the bundled patch is applied automatically as a bundle layer.

### Verify

- `dsh --profile web --dump-config` contains exactly one `build-plan-mode` row and `ui-plan: disabled`.
- The Web UI shows the Build/Plan segmented control in the composer; `/bplan plan` switches the next-message mode.

## Uninstall / rollback

Remove the package from the profile's dependencies and `dsh.profile.bundles` (or set `disabled: true` on both patch entries), then restart DSH. Every listener, projection, policy wrapper, Slot, style, keyboard handler, and child restriction is lifecycle-owned and disappears with the plugin; the native Plan UI returns unchanged. Session data written by the plugin reuses native event records only, so cold-loading without the plugin is always safe.

## Development

```powershell
npm install
npm run build        # emits everything into lib/ (outputs defined by scripts/lib-roster.mjs)
npm test             # focused plugin tests
npm run deploy:user-profile   # dev helper: copy the build into ~/.dsh/profiles/web
```

Design authorities: `docs/build-plan-mode-spec.md` (product behavior) and `docs/build-plan-mode-design.md` (implementation) inside this package. Acceptance evidence: `ACCEPTANCE.md`.

Note for forks intending to publish under a different name: rename the package in `package.json` and update the `name:` reference inside `cordis.patch.yml` to match.

## Support

Use the repository issue tracker for questions and bug reports; see [SECURITY.md](SECURITY.md) for private vulnerability reporting, [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose changes, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards, and [CHANGELOG.md](CHANGELOG.md) for release history.

## FAQ

**Is this an official DeepSeek product?**

No. This is an independent community plugin. It is not affiliated with, endorsed by, or supported by DeepSeek.

**Does it modify my DeepSeek Harness installation?**

No. It mounts from your Web profile composition only — zero changes to DSH core, the npm installation, the Web shell, or shipped presets. Removing it restores stock behavior.

**Which DSH versions are supported?**

`0.1.5-rc.2` (Web) is the verified release; `0.1.1-rc.2` also works, because the Host reads the session log through both host shapes (`snapshotEvents()` or the older `events` array). A newer release requires re-running the seam gate first.

**How does Plan enforce read-only?**

A host-side monotonic tool guard denies mutation-class tools before they run, using public rc.2 seams only. No private APIs are wrapped, and no host patches are shipped or required.

**Is there a plan mode in stock DSH already?**

Native Plan exists but is step-oriented and takes over the review flow. This plugin provides a persistent per-session Build/Plan workflow instead, coexisting via profile composition.

## License

[MIT](LICENSE) — see [LICENSE](LICENSE).
