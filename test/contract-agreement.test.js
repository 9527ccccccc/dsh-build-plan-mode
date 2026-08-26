// Agreement assertions read built artifacts under lib/ — run scripts/build.mjs
// first (npm run build) so these pins observe fresh output.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

import { BPLAN_CONTRACT } from '../src/contract.js'
import { MODE_COMMAND, MODE_PROJECTION_KEY, STATE_COMMAND } from '../src/index.js'
import { MODE_PROJECTION_KEY as CLIENT_MODE_PROJECTION_KEY } from '../src/client.js'

test('both halves derive their exported wire names from the contract', () => {
  assert.equal(MODE_PROJECTION_KEY, BPLAN_CONTRACT.projection.key)
  assert.equal(CLIENT_MODE_PROJECTION_KEY, BPLAN_CONTRACT.projection.key)
  assert.equal(MODE_COMMAND, BPLAN_CONTRACT.commands.interactive)
  assert.equal(STATE_COMMAND, BPLAN_CONTRACT.commands.state)
})

test('contract holds exactly the four identity facts, deeply frozen and JSON-safe', () => {
  assert.deepEqual(BPLAN_CONTRACT, {
    projection: { key: 'bplanMode', attribute: 'data-bplan-mode' },
    commands: { interactive: 'bplan', state: 'bplan-state' },
  })
  assert.equal(Object.isFrozen(BPLAN_CONTRACT), true)
  assert.equal(Object.isFrozen(BPLAN_CONTRACT.projection), true)
  assert.equal(Object.isFrozen(BPLAN_CONTRACT.commands), true)
  const serialized = JSON.stringify(BPLAN_CONTRACT)
  assert.deepEqual(JSON.parse(serialized), BPLAN_CONTRACT)
})

test('no raw wire spelling survives outside the contract module under src/', async () => {
  const entries = await readdir(new URL('../src/', import.meta.url))
  const sources = entries.filter((name) => name.endsWith('.js') && name !== 'contract.js')
  assert.ok(sources.length >= 3, `expected the known src modules, found: ${sources.join(', ')}`)
  const spellings = [
    ['quoted projection key', /(['"`])bplanMode\1/],
    ['quoted marker attribute', /(['"`])data-bplan-mode\1/],
    ['standalone interactive name', /(?<![\w-])bplan(?![\w/:,-])/],
    ['state name in quoted or template-prefix form', /(['"`])bplan-state\1|`bplan-state/],
  ]
  for (const name of sources) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')
    for (const [label, pattern] of spellings) {
      assert.doesNotMatch(source, pattern, `${name} hand-spells ${label} outside the contract`)
    }
  }
  // The state-command id namespace must be composed through the contract alias.
  const hostSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  assert.match(hostSource, /\$\{STATE_COMMAND\}-/)
})

test('built client artifact embeds the exact serialized contract and stays standalone', async () => {
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, new RegExp(`const BPLAN_CONTRACT = ${JSON.stringify(BPLAN_CONTRACT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.doesNotMatch(bundle, /\bimport\s*\(\s*['"]/)
  assert.doesNotMatch(bundle, /from\s+['"]\.\.?\//)
})

// Pin: artifact-layer identity check for the Host half's contract copy —
// deliberately direct rather than roster-driven, so it still guards this
// one copy even if the roster module itself ever drifts.
test('built outputs carry a verbatim contract copy for the copied Host half', async () => {
  const [source, copied] = await Promise.all([
    readFile(new URL('../src/contract.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/contract.js', import.meta.url), 'utf8'),
  ])
  assert.equal(copied, source)
})
