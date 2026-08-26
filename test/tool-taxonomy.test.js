import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHILD_CREATING_TOOLS,
  CHILD_NEVER_TOOLS,
  PLAN_OBSERVATION_TOOLS,
  TOOL_CLASSES,
} from '../src/tool-taxonomy.js'

// Reviewed rosters: the second spelling site by design, mirroring the
// wire-contract agreement suite. Policy modules must consume the taxonomy,
// never restate it — enforced by the declaration-uniqueness scan below.
const CLASS_ROSTERS = {
  observation: [
    'cordis_inspect_list',
    'cordis_inspect_query',
    'cordis_inspect_self',
    'get_goal',
    'glob',
    'grep',
    'job_list',
    'job_output',
    'list_agents',
    'preset_roster_list',
    'read',
    'read_image',
    'skill',
    'web_search',
  ],
  orchestration: ['subagent', 'subagent_fork', 'workflow', 'ralph', 'send_message'],
  agentControl: ['job_kill', 'interrupt_agent'],
  goalMutation: ['create_goal', 'update_goal'],
  runtimeMutation: ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine'],
  interpreter: ['pwsh', 'bash', 'terminal', 'run_code'],
}

test('six named classes carry the exact reviewed rosters, deeply frozen', () => {
  assert.deepEqual(TOOL_CLASSES, CLASS_ROSTERS)
  assert.deepEqual(Object.keys(TOOL_CLASSES), Object.keys(CLASS_ROSTERS))
  assert.ok(Object.isFrozen(TOOL_CLASSES))
  for (const names of Object.values(TOOL_CLASSES)) {
    assert.ok(Object.isFrozen(names))
  }
})

test('derived aggregates compose exactly from the declared classes', () => {
  assert.deepEqual(PLAN_OBSERVATION_TOOLS, CLASS_ROSTERS.observation)
  const neverExpected = Object.freeze([
    ...CLASS_ROSTERS.orchestration,
    ...CLASS_ROSTERS.agentControl,
    ...CLASS_ROSTERS.goalMutation,
    ...CLASS_ROSTERS.runtimeMutation,
    ...CLASS_ROSTERS.interpreter,
  ])
  assert.deepEqual(CHILD_NEVER_TOOLS, neverExpected)
  assert.deepEqual(CHILD_CREATING_TOOLS, ['subagent', 'subagent_fork'])
  assert.ok(Object.isFrozen(PLAN_OBSERVATION_TOOLS))
  assert.ok(Object.isFrozen(CHILD_NEVER_TOOLS))
  assert.ok(Object.isFrozen(CHILD_CREATING_TOOLS))
})

test('parent allowlist and child never-set are disjoint', () => {
  for (const name of PLAN_OBSERVATION_TOOLS) {
    assert.equal(CHILD_NEVER_TOOLS.includes(name), false, name)
  }
  for (const name of CHILD_NEVER_TOOLS) {
    assert.equal(PLAN_OBSERVATION_TOOLS.includes(name), false, name)
  }
})

test('every classified rosters pair is disjoint across classes', () => {
  const seen = new Map()
  for (const [className, names] of Object.entries(CLASS_ROSTERS)) {
    for (const name of names) {
      assert.equal(seen.has(name), false, `${name} in ${className} and ${seen.get(name)}`)
      seen.set(name, className)
    }
  }
})

test('each classified tool name survives as a literal in exactly one src module', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
  const offenders = []
  for (const entry of readdirSync(srcDir)) {
    if (!entry.endsWith('.js') || entry === 'tool-taxonomy.js') continue
    const text = readFileSync(join(srcDir, entry), 'utf8')
    for (const names of Object.values(CLASS_ROSTERS)) {
      for (const name of names) {
        if (new RegExp(`['"\`]${name}['"\`]`).test(text)) offenders.push(`${entry}: ${name}`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})
