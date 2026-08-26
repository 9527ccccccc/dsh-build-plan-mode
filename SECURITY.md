# Security Policy

## Reporting a vulnerability

Do **not** open a public issue. Use the repository's private security advisory (GitHub → Security → Report a vulnerability) with a description, reproduction steps, and impact.

Best-effort response: acknowledgment within a few days, fix coordinated privately before any public disclosure, credit in the advisory unless you decline.

## Scope notes

- The plugin runs inside your DSH process with the capabilities the host grants it. It requests no filesystem, network, or shell authority of its own; its Host half only classifies and denies tool executions.
- **Plan mode is a workflow guard, not a hardened security boundary.** It enforces read-only behavior by denying tool calls before they run on stock rc.2 seams. If you find a way for a Plan turn to mutate state — a denial bypass, a lifecycle leak after stop/remount, or Research Children escaping their restrictions — that is exactly what we want reported.
- Supply chain is deliberately minimal: zero npm dependencies at runtime; `react` and `@deepseek-ai/dsh-api-remotes` are provided by the DSH module loader itself.

## Supported versions

| Plugin | DSH | Support |
| --- | --- | --- |
| 0.1.x | 0.1.1-rc.2 | security fixes, best effort |

Older DSH releases were never supported; newer releases require re-running the seam gate first (`ACCEPTANCE.md`).
