import { join } from 'node:path'

/**
 * Single owner of the install-identity mapping: the package's declared
 * name decides where its deployed files must land under the DSH web
 * profile. Pure and side-effect free so tests cross this seam directly;
 * the deploy script and any future installer consume it instead of
 * hand-spelling the destination.
 *
 * Scoped names are required (`scope/id`) — npm identities without a
 * scope cannot address a profile package directory, so they fail closed.
 */
export function profilePackageDirectory(packageName, dshHome) {
  const segments = String(packageName).split('/')
  if (segments.length !== 2) {
    throw new TypeError(`package name must be scoped "scope/id": ${String(packageName)}`)
  }
  const [scope, id] = segments
  // Approximate npm name shape: scope starts with "@", both sides are
  // registry-shaped segments. Exact registry rules live with npm; this
  // fails closed on anything that would form a nonsense directory.
  const shaped = (segment) => /^[a-z0-9][a-z0-9._-]*$/i.test(segment)
  if (!(scope.startsWith('@') && shaped(scope.slice(1)) && shaped(id))) {
    throw new TypeError(`package name must be scoped "scope/id": ${String(packageName)}`)
  }
  return join(dshHome, 'profiles', 'web', 'node_modules', scope, id)
}
