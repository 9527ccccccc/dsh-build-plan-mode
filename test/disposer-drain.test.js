import assert from 'node:assert/strict'
import test from 'node:test'

import { drainDisposers } from '../src/disposer-drain.js'

test('drains in reverse installation order and contains sync throws', async () => {
  const calls = []
  const throwing = () => { throw new Error('second failed') }
  const outcome = drainDisposers([
    () => calls.push('first'),
    throwing,
    () => calls.push('third'),
  ])
  assert.equal(calls.join(), 'third,first')
  assert.deepEqual(await outcome, [new Error('second failed')])
})

test('consumes the caller array so a repeated invocation drains nothing', async () => {
  const calls = []
  const disposers = [() => calls.push('only')]
  await drainDisposers(disposers)
  assert.deepEqual(await drainDisposers(disposers), [])
  assert.equal(calls.length, 1)
})

test('awaits each returned promise before starting the next disposer', async () => {
  const events = []
  const settle = []
  const slow = () => new Promise((resolve) => settle.push(() => { events.push('slow settled'); resolve() }))
  const drained = drainDisposers([slow, () => events.push('fast')])
  await Promise.resolve()
  assert.equal(events.includes('slow settled'), false)
  for (let index = 0; index < 10 && settle.length === 0; index += 1) await Promise.resolve()
  assert.equal(typeof settle[0], 'function')
  settle[0]()
  await drained
  assert.deepEqual(events, ['fast', 'slow settled'])
})

test('contains rejected promises from async disposers', async () => {
  const failure = new Error('async cleanup failed')
  const outcome = drainDisposers([() => Promise.reject(failure)])
  assert.deepEqual(await outcome, [failure])
})

test('an empty roster resolves to no errors', async () => {
  assert.deepEqual(await drainDisposers([]), [])
})
