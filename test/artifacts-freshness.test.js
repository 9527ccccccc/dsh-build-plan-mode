import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { VERBATIM_COPIES } from '../scripts/lib-roster.mjs'

test('every verbatim lib copy is byte-fresh against its source', async () => {
  for (const name of VERBATIM_COPIES) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')
    const copy = await readFile(new URL(`../lib/${name}`, import.meta.url), 'utf8')
    assert.equal(copy, source, `lib/${name} is stale; run npm run build before testing or committing`)
  }
})
