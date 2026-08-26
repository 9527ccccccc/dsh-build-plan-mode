/**
 * Single owner of the lib roster: which modules ship in the deployed
 * `lib/` directory, and how each one is produced. Every consumer — the
 * build's verbatim emission, the profile deploy, and the freshness pin —
 * reads this list instead of keeping its own, so adding a module is a
 * one-edit change and an omitted copy line is structurally impossible.
 *
 * Import-safe by design (no top-level side effects): tests and scripts
 * consume it freely. Order matters only for diff readability; keep new
 * entries appended so artifact churn stays attributable.
 */

/** Modules copied verbatim from src/ into lib/ by the build. */
export const VERBATIM_COPIES = Object.freeze([
  'index.js',
  'research-child.js',
  'contract.js',
  'tool-taxonomy.js',
  'disposer-drain.js',
])

/** The generated client bundle is assembled, not copied — but ships too. */
export const GENERATED_BUNDLES = Object.freeze(['client.js'])

/** Everything that must exist in lib/ after a build, and thus deploy. */
export const ALL_LIB_FILES = Object.freeze([...VERBATIM_COPIES, ...GENERATED_BUNDLES])
