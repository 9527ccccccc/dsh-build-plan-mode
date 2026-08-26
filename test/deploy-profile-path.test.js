import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { join } from 'node:path'

import { profilePackageDirectory } from '../scripts/profile-identity.mjs'

test('the current declared identity maps to the historical profile directory', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(
    profilePackageDirectory(manifest.name, 'DSH_HOME'),
    join('DSH_HOME', 'profiles', 'web', 'node_modules', '@local', 'dsh-build-plan-mode-v2'),
  )
})

test('a renamed fork deploys under its own declared identity', () => {
  assert.equal(
    profilePackageDirectory('@acme/dsh-build-plan-mode', 'DSH_HOME'),
    join('DSH_HOME', 'profiles', 'web', 'node_modules', '@acme', 'dsh-build-plan-mode'),
  )
})

test('unscoped or malformed identities fail closed', () => {
  assert.throws(() => profilePackageDirectory('dsh-build-plan-mode-v2', 'H'), TypeError)
  assert.throws(() => profilePackageDirectory('@local/', 'H'), TypeError)
  assert.throws(() => profilePackageDirectory('@local/a/b', 'H'), TypeError)
  assert.throws(() => profilePackageDirectory('@./id', 'H'), TypeError)
  assert.throws(() => profilePackageDirectory('@/id', 'H'), TypeError)
  assert.throws(() => profilePackageDirectory('@local/.', 'H'), TypeError)
})
