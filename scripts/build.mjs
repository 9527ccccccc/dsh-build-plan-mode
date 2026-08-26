import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { deepStrictEqual } from 'node:assert/strict'
import { BPLAN_CONTRACT } from '../src/contract.js'
import { PLUGIN_PACKAGE_ID as packageId } from '../src/client.js'
import { VERBATIM_COPIES } from './lib-roster.mjs'

const serializedContract = JSON.stringify(BPLAN_CONTRACT)
deepStrictEqual(JSON.parse(serializedContract), BPLAN_CONTRACT,
  'wire contract must survive a JSON round trip unchanged')

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const drainSource = await readFile(new URL('../src/disposer-drain.js', import.meta.url), 'utf8')
const inlinedDrain = drainSource.replace(/^export function /m, 'function ')
const transformed = source
  .replace(/^import \{ BPLAN_CONTRACT \} from '\.\/contract\.js'\r?\n/m, '')
  .replace(/^import \{ drainDisposers \} from '\.\/disposer-drain\.js'\r?\n/m, '')
  .replaceAll('export const ', 'const ')
  .replaceAll('export function ', 'function ')
  .replace(/export default \{[\s\S]*?\}\s*$/m, '')
const exportResidue = /^[\t ]*export(?:\s+(?:default|async|const|let|var|function\*?|class)\b|\s*\{|\s*\*)/m
for (const [name, text] of [['inlined helper', inlinedDrain], ['client source', transformed]]) {
  if (exportResidue.test(text)) {
    throw new Error(`client bundle must be standalone: ${name} still declares an export after stripping (${exportResidue.exec(text)[0].trim()})`)
  }
}
if (/\bimport\s*\(\s*['"]/.test(transformed) || /(^|\n)\s*import\s+['"]/.test(transformed) || /from\s+['"]\.\.?\//.test(transformed)) {
  throw new Error('client bundle must be standalone: unresolved relative import survived transformation')
}

const indent = (text) => text.split('\n').map((line) => line === '' ? '' : `    ${line}`).join('\n')

const clientBundle = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(packageId)},\n  factory: (require) => {\n    const module = { exports: {} }\n    const BPLAN_CONTRACT = ${serializedContract}\n    const React = require('react')
    require('@deepseek-ai/dsh-api-remotes')
${indent(inlinedDrain)}\n${indent(transformed)}\n    module.exports.inject = ['slots', 'remote', 'remote.commands']
    module.exports.apply = (ctx) => apply(ctx, createProductionRuntime(ctx, { React, window, document }))
    return module.exports\n  },\n})\n`

await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
for (const name of VERBATIM_COPIES) {
  await writeFile(
    new URL(`../lib/${name}`, import.meta.url),
    await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'),
  )
}
await writeFile(new URL('../lib/client.js', import.meta.url), clientBundle)
