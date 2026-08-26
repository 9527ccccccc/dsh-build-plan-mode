/**
 * Single owner of the plugin's uninstall sequence: collect disposers, run
 * them in reverse installation order exactly once, contain every failure,
 * and hand back the collected errors. Sync throws and returned thenables
 * are contained alike; each disposer settles before the next starts.
 *
 * Consumes the caller's array (`splice(0)`), so a repeated invocation
 * drains nothing — exactly-once pairs with the caller's task memoization.
 */
export function drainDisposers(disposers) {
  const pending = disposers.splice(0).reverse()
  const errors = []
  const drain = (index) => {
    for (; index < pending.length; index += 1) {
      let result
      try { result = pending[index]() } catch (error) { errors.push(error); continue }
      if (result !== null && typeof result?.then === 'function') {
        return Promise.resolve(result)
          .catch((error) => { errors.push(error) })
          .then(() => drain(index + 1))
      }
    }
    return errors
  }
  return Promise.resolve(drain(0))
}
