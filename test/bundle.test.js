import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

test('standard client bundle declares Cordis dependencies and lifecycle-owned styles', () => {
  assert.match(bundle, /id: "@local\/dsh-build-plan-mode-v2"/)
  assert.match(bundle, /module\.exports\.inject = \['slots', 'remote', 'remote\.commands'\]/)
  assert.doesNotMatch(bundle, /modelDirectories|effectiveModelKey|installModelDirectoryInvalidation/)
  assert.match(bundle, /return \(\) => tag\.remove\(\)/)
  assert.match(bundle, /textarea,\[contenteditable="true"\],\[\$\{BPLAN_CONTRACT\.projection\.attribute\}\]/)
  assert.doesNotMatch(bundle, /\[data-bplan-mode\]/)
  assert.match(bundle, /\[data-slot\^="settings\."\]/)
  assert.match(bundle, /\[data-slot="conversation\.input\.overlay"\],\[data-slot="conversation\.input\.dock"\]/)
  assert.match(bundle, /\[role="dialog"\],\[role="alertdialog"\]/)
  assert.match(bundle, /\[role="grid"\],\[role="tree"\],\[role="tablist"\],\[aria-activedescendant\]/)
  assert.doesNotMatch(bundle, /settings: false|interactionPanel: false|keyboardManaged: false/)
})

test('the generated bundle carries no export statements after stripping', () => {
  assert.doesNotMatch(bundle, /^[\t ]*export(?:\s+(?:default|async|const|let|var|function\*?|class)\b|\s*\{|\s*\*)/m)
})
