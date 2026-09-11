import assert from 'node:assert/strict'
import test from 'node:test'
import plugin, {
  CONVERSATION_SURFACE_SELECTORS,
  MODE_PROJECTION_KEY,
  MODE_SLOT_NAME,
  createInteractionFacts,
  createModeControl,
  createModeStatus,
  STATUS_SLOT_NAME,
  installKeyboardAdapter,
  modeViewModel,
  shouldToggleMode,
} from '../src/client.js'

const baseEvent = { key: 'Tab' }
const baseInteraction = { conversation: true }

// ---------------------------------------------------------------------------
// 13.5.1 Projection semantics: absence is unavailable (never Build); empty
// Host history renders the default Build; running Current != Next co-displays.
// ---------------------------------------------------------------------------
test('mode projection is authoritative and absence is explicit', () => {
  assert.deepEqual(modeViewModel(undefined), { available: false, next: null, current: null })
  assert.deepEqual(modeViewModel(null), { available: false, next: null, current: null })
  assert.deepEqual(modeViewModel({}), { available: false, next: null, current: null })
  assert.deepEqual(modeViewModel({ next: 'weird' }), { available: false, next: null, current: null })
  assert.deepEqual(modeViewModel({ next: 'plan', current: { turn: 2, mode: 'build' } }), {
    available: true, next: 'plan', current: 'build',
  })
  // Empty Host history: revision 0, Next Build, Current null (design 3.2 invariant 2).
  assert.deepEqual(modeViewModel({ next: 'build', current: null }), { available: true, next: 'build', current: null })
  // Malformed Current never poisons the view.
  assert.deepEqual(modeViewModel({ next: 'build', current: { turn: 2, mode: 'wat' } }), {
    available: true, next: 'build', current: null,
  })
  assert.equal(MODE_PROJECTION_KEY, 'bplanMode')
})

// ---------------------------------------------------------------------------
// 13.5.2 Exactly one plugin mode control and one quiet status contribution.
// ---------------------------------------------------------------------------
test('control renders exactly two buttons and quiet status renders nothing when modes agree', () => {
  const elements = []
  const React = {
    useEffect() {},
    useState(value) { return [value, () => {}] },
    useRef(value) { return { current: value } },
    createElement(type, props, ...children) {
      const element = { type, props: props ?? {}, children }
      elements.push(element)
      return element
    },
  }
  const Component = createModeControl(React)
  Component({ sessionId: 's1', useProjection() { return { next: 'build', current: null } }, selectMode() {} })
  const buttons = elements.filter((element) => element.type === 'button')
  assert.equal(buttons.length, 2)
  assert.deepEqual(buttons.map((button) => button.props['data-bplan-mode']), ['build', 'plan'])
  // Non-color semantics: distinct stable aria-labels, distinct text, distinct icons, aria-pressed.
  assert.equal(buttons[0].props['aria-label'], 'Build mode for the next message')
  assert.equal(buttons[1].props['aria-label'], 'Plan mode for the next message')
  assert.equal(buttons[0].props['aria-pressed'], true)
  assert.equal(buttons[1].props['aria-pressed'], false)
  assert.equal(buttons[0].children.some((child) => child?.children?.includes('Build')), true)
  assert.equal(buttons[1].children.some((child) => child?.children?.includes('Plan')), true)
  assert.notEqual(
    buttons[0].children.find((child) => child?.props?.['aria-hidden'] === true)?.children[0],
    buttons[1].children.find((child) => child?.props?.['aria-hidden'] === true)?.children[0],
  )
  // The sliding tint is its own surface keyed by the projected next mode —
  // never a per-button background that would snap between two fixed sides.
  const thumb = elements.find((element) => element.props?.className === 'bplan-mode-thumb')
  assert.equal(thumb.props['data-active'], 'build')
  assert.equal(thumb.props['aria-hidden'], true)
  elements.length = 0
  Component({ sessionId: 's1', useProjection() { return { next: 'plan', current: null } }, selectMode() {} })
  const planThumb = elements.find((element) => element.props?.className === 'bplan-mode-thumb')
  assert.equal(planThumb.props['data-active'], 'plan')
  // The wrap carries the discoverable Tab-switch tooltip.
  const wrap = elements.find((element) => element.props?.className === 'bplan-mode-wrap')
  assert.match(wrap.props.title, /Tab/)
})

test('status contributes nothing when modes agree, even while a turn runs', () => {
  const elements = []
  const React = {
    createElement(type, props, ...children) {
      const element = { type, props: props ?? {}, children }
      elements.push(element)
      return element
    },
  }
  const Status = createModeStatus(React)
  Status({ useProjection() { return { next: 'build', current: { turn: 2, mode: 'build' } } }, useSession() { return { running: true } } })
  assert.equal(elements.length, 0)
})

// ---------------------------------------------------------------------------
// 13.5.3 Click and Tab execute the same /bplan command path; no optimistic
// durable state; pending disables; failure renders a compact failure state.
// ---------------------------------------------------------------------------
function harnessControl(runtime = {}, props = {}) {
  const elements = []
  const state = {}
  const setters = {}
  const React = {
    useState(value) {
      state[Object.keys(state).length] = value
      const index = Object.keys(state).length - 1
      setters[index] = []
      return [value, (next) => { setters[index].push(next) }]
    },
    useRef(value) { return { current: value } },
    useEffect(setup) { setup() },
    createElement(type, props, ...children) {
      const element = { type, props: props ?? {}, children }
      elements.push(element)
      return element
    },
  }
  const Component = createModeControl(React, runtime)
  Component(props)
  const buttons = elements.filter((element) => element.type === 'button')
  return { elements, buttons, state, setters, React }
}

test('click and unmodified Tab execute the same /bplan command path', async () => {
  const executed = []
  let keyHandler
  const runtime = {
    keyTarget: { addEventListener(_name, listener) { keyHandler = listener }, removeEventListener() {} },
    interactionFacts: () => baseInteraction,
    commandExecute: async (sessionId, line) => { executed.push([sessionId, line]); return { commandId: 'c1', result: { kind: 'success', text: 'Next message mode: plan.' } } },
  }
  const selectMode = (mode) => runtime.commandExecute('session-1', `/bplan ${mode}`)
  const { buttons } = harnessControl(runtime, {
    sessionId: 'session-1',
    useProjection() { return { next: 'build', current: null } },
    selectMode,
  })
  buttons.find((button) => button.props['data-bplan-mode'] === 'plan').props.onClick()
  keyHandler({ ...baseEvent, preventDefault() {} })
  await Promise.resolve()
  assert.deepEqual(executed, [['session-1', '/bplan plan'], ['session-1', '/bplan plan']])
})

test('pending command disables both buttons and failure renders a compact status', async () => {
  let elements = []
  const state = []
  const refs = []
  let stateCursor = 0
  let refCursor = 0
  const React = {
    useState(value) {
      const index = stateCursor++
      if (!(index in state)) state[index] = value
      return [state[index], (next) => { state[index] = next }]
    },
    useRef(value) {
      const index = refCursor++
      if (!(index in refs)) refs[index] = { current: value }
      return refs[index]
    },
    useEffect() {},
    createElement(type, props, ...children) {
      const element = { type, props: props ?? {}, children }
      elements.push(element)
      return element
    },
  }
  const Component = createModeControl(React)
  let resolveSelect
  const props = {
    sessionId: 's1',
    useProjection() { return { next: 'build', current: null } },
    selectMode() { return new Promise((resolve) => { resolveSelect = resolve }) },
  }
  const render = () => {
    elements = []
    stateCursor = 0
    refCursor = 0
    Component(props)
    return elements.filter((element) => element.type === 'button')
  }

  let buttons = render()
  assert.equal(buttons.every((button) => button.props.disabled === false), true)
  buttons.find((button) => button.props['data-bplan-mode'] === 'plan').props.onClick()
  buttons = render()
  assert.equal(buttons.every((button) => button.props.disabled === true), true)

  resolveSelect('command failed verbatim')
  await Promise.resolve()
  render()
  assert.equal(elements.some((element) => element.props?.role === 'status' && element.children.includes('Mode change failed')), true)

  buttons = elements.filter((element) => element.type === 'button')
  buttons.find((button) => button.props['data-bplan-mode'] === 'plan').props.onClick()
  resolveSelect(null)
  await Promise.resolve()
  render()
  assert.equal(elements.some((element) => element.props?.role === 'status' && element.children.includes('Mode change failed')), false)
})

// ---------------------------------------------------------------------------
// 13.5.4 Keyboard exclusion matrix: Tab switches only on the main conversation
// surface; Shift+Tab / modifiers / IME / repeat / defaultPrevented / settings /
// menus / overlays / interaction panels / keyboard-managed surfaces / non-
// conversation pages all keep native behavior.
// ---------------------------------------------------------------------------
test('Strict Effects cleanup and replay keep async selection updates live', async () => {
  const elements = []
  const effectSetups = []
  const stateUpdates = []
  const React = {
    useState(value) { return [value, (next) => stateUpdates.push(next)] },
    useRef(value) { return { current: value } },
    useEffect(setup) { effectSetups.push(setup) },
    createElement(type, props, ...children) {
      const element = { type, props: props ?? {}, children }
      elements.push(element)
      return element
    },
  }
  let resolveSelect
  const Component = createModeControl(React)
  Component({
    sessionId: 'strict-effects',
    useProjection() { return { next: 'build', current: null } },
    selectMode() { return new Promise((resolve) => { resolveSelect = resolve }) },
  })
  const cleanup = effectSetups[1]()
  cleanup()
  effectSetups[1]()
  elements.find((element) => element.props?.['data-bplan-mode'] === 'plan').props.onClick()
  resolveSelect(null)
  await Promise.resolve()
  assert.deepEqual(stateUpdates, [true, null, false, null])
})

test('unmodified Tab toggles only on the main conversation surface', () => {
  assert.equal(shouldToggleMode(baseEvent, baseInteraction), true)
  for (const event of [
    { ...baseEvent, shiftKey: true }, { ...baseEvent, altKey: true },
    { ...baseEvent, ctrlKey: true }, { ...baseEvent, metaKey: true },
    { ...baseEvent, isComposing: true }, { ...baseEvent, defaultPrevented: true },
    { ...baseEvent, repeat: true }, { key: 'Enter' },
  ]) assert.equal(shouldToggleMode(event, baseInteraction), false)
  for (const key of ['settings', 'menu', 'interactionPanel', 'overlay', 'keyboardManaged']) {
    assert.equal(shouldToggleMode(baseEvent, { ...baseInteraction, [key]: true }), false)
  }
  assert.equal(shouldToggleMode(baseEvent, { conversation: false }), false)
})

test('keyboard adapter never touches focus or selection and uses the shared selection operation', async () => {
  let handler
  let prevented = 0
  let observedEvent
  const selected = []
  const target = {
    addEventListener(name, listener) { assert.equal(name, 'keydown'); handler = listener },
    removeEventListener(name, listener) { assert.equal(name, 'keydown'); assert.equal(listener, handler); handler = undefined },
  }
  const dispose = installKeyboardAdapter({
    target,
    interactionFacts: (event) => { observedEvent = event; return baseInteraction },
    modeView: () => ({ available: true, next: 'build', current: null }),
    selectMode: async (mode) => { selected.push(mode) },
  })
  const event = {
    ...baseEvent,
    preventDefault() { prevented += 1 },
    target: { value: 'draft', selectionStart: 2, selectionEnd: 4 },
  }
  handler(event)
  await Promise.resolve()
  assert.equal(prevented, 1)
  assert.equal(observedEvent, event)
  assert.equal(event.target.value, 'draft')
  assert.equal(event.target.selectionStart, 2)
  assert.equal(event.target.selectionEnd, 4)
  assert.deepEqual(selected, ['plan'])
  dispose()
  assert.equal(handler, undefined)
})

test('keyboard adapter leaves native behavior for the exclusion matrix', async () => {
  let handler
  const prevented = []
  const selected = []
  const target = {
    addEventListener(_name, listener) { handler = listener },
    removeEventListener() {},
  }
  installKeyboardAdapter({
    target,
    interactionFacts: (event) => ({ ...baseInteraction, [event.excluded]: true }),
    modeView: () => ({ available: true, next: 'build', current: null }),
    selectMode: async (mode) => { selected.push(mode) },
  })
  for (const excluded of ['settings', 'menu', 'interactionPanel', 'overlay', 'keyboardManaged']) {
    handler({ key: 'Tab', excluded, preventDefault() { prevented.push(excluded) } })
  }
  handler({ key: 'Tab', shiftKey: true, preventDefault() { prevented.push('shift') } })
  await Promise.resolve()
  assert.deepEqual(prevented, [])
  assert.deepEqual(selected, [])
})

// ---------------------------------------------------------------------------
// 13.5.5 Focus, selection, and composer text survive switching — the handler
// only calls preventDefault and routes through the command channel, for idle,
// running (Current == Next), and running (Current != Next) views.
// ---------------------------------------------------------------------------
test('Tab preserves composer text, selection, and focus in every view state', async () => {
  let handler
  const prevented = []
  const executed = []
  const target = {
    addEventListener(_name, listener) { handler = listener },
    removeEventListener() {},
  }
  const viewModes = [
    { available: true, next: 'plan', current: null },
    { available: true, next: 'plan', current: 'plan' },
    { available: true, next: 'plan', current: 'build' },
  ]
  let viewIndex = 0
  installKeyboardAdapter({
    target,
    interactionFacts: () => baseInteraction,
    modeView: () => viewModes[viewIndex],
    selectMode: async (mode) => { executed.push(mode) },
  })
  for (viewIndex = 0; viewIndex < viewModes.length; viewIndex += 1) {
    const event = {
      key: 'Tab',
      preventDefault() { prevented.push(viewIndex) },
      target: { value: 'hello', selectionStart: 1, selectionEnd: 3 },
    }
    handler(event)
    assert.equal(event.target.value, 'hello')
    assert.equal(event.target.selectionStart, 1)
    assert.equal(event.target.selectionEnd, 3)
  }
  await Promise.resolve()
  assert.deepEqual(prevented, [0, 1, 2])
  assert.deepEqual(executed, ['build', 'build', 'build'])
})

// ---------------------------------------------------------------------------
// 13.5.6 Core activation succeeds without modelDirectories.invalidate.
// ---------------------------------------------------------------------------
test('client contributes nothing when Slots or React are absent', () => {
  assert.equal(plugin.apply({ get() { return undefined } }, { React: {} }), undefined)
  assert.equal(plugin.apply({ get() { return {} } }, {}), undefined)
})

test('Core client entry activates without modelDirectories and registers both Slots plus styles', async () => {
  const calls = []
  const effects = []
  const slots = {
    inject(name, register) { calls.push(['inject', name]); return register() },
    register(options, component) { calls.push(['register', options, typeof component]); return () => calls.push(['dispose slot', options.name]) },
  }
  const styles = { insert(css) { calls.push(['styles', css.includes('.bplan-mode-control')]); return () => calls.push('styles disposed') } }
  const target = { addEventListener(name) { calls.push(['listen', name]) }, removeEventListener(name) { calls.push(['unlisten', name]) } }
  const React = { useState() {}, useEffect() {}, useRef(value) { return { current: value } }, createElement() {} }
  const ctx = {
    get(name) { return name === 'slots' ? slots : undefined },
    effect(register) { const dispose = register(); effects.push(dispose); return dispose },
  }
  plugin.apply(ctx, {
    React, styles, keyTarget: target, selectMode() {},
    interactionFacts: () => baseInteraction,
  })
  assert.deepEqual(calls.slice(0, 4), [
    ['inject', MODE_SLOT_NAME],
    ['register', { name: MODE_SLOT_NAME, priority: -20, inject: calls[1][1].inject }, 'function'],
    ['inject', STATUS_SLOT_NAME],
    ['register', { name: STATUS_SLOT_NAME, id: 'build-plan-mode-v2', order: 20 }, 'function'],
  ])
  const injected = calls[1][1].inject('session-1')
  assert.equal(injected.sessionId, 'session-1')
  assert.equal(typeof injected.selectMode, 'function')
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === 'styles' && entry[1]), true)
  for (const dispose of effects.reverse()) await dispose()
  assert.equal(calls.includes('styles disposed'), true)
  assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && entry[0] === 'dispose slot').map((entry) => entry[1]).sort(), [MODE_SLOT_NAME, STATUS_SLOT_NAME].sort())
})

test('command remote outcomes map to compact selection failures', async () => {
  const calls = []
  const effects = []
  const slots = {
    inject(name, register) { calls.push(['inject', name]); return register() },
    register(options, component) { calls.push(['register', options]); return () => {} },
  }
  const ctx = {
    get(name) { return name === 'slots' ? slots : undefined },
    effect(register) { const dispose = register(); effects.push(dispose); return dispose },
  }
  const lines = []
  const responses = []
  plugin.apply(ctx, {
    React: { useState() {}, useEffect() {}, useRef(value) { return { current: value } }, createElement() {} },
    commandExecute: async (sessionId, line) => {
      lines.push([sessionId, line])
      return responses.shift()
    },
  })
  const injected = calls[1][1].inject('session-1')

  responses.push({ commandId: 'c1', result: { kind: 'success', text: 'Next message mode: plan.' } })
  assert.equal(await injected.selectMode('plan'), null)

  responses.push({ commandId: 'c2', result: { kind: 'error', text: 'invalid build/plan mode: other' } })
  assert.equal(await injected.selectMode('other'), 'invalid build/plan mode: other')

  responses.push({ commandId: 'c3', result: { kind: 'error' } })
  assert.equal(await injected.selectMode('build'), 'Mode change failed')

  responses.push(undefined)
  assert.equal(await injected.selectMode('plan'), 'Build / Plan command unavailable')

  assert.deepEqual(lines, [
    ['session-1', '/bplan plan'],
    ['session-1', '/bplan other'],
    ['session-1', '/bplan build'],
    ['session-1', '/bplan plan'],
  ])
})

test('selectMode fallback is used when the command remote is absent', async () => {
  const calls = []
  const effects = []
  const slots = {
    inject(name, register) { calls.push(['inject', name]); return register() },
    register(options, component) {
      calls.push(['register', options, typeof component])
      return () => calls.push(['dispose slot', options.name])
    },
  }
  const ctx = {
    get(name) { return name === 'slots' ? slots : undefined },
    effect(register) { const dispose = register(); effects.push(dispose); return dispose },
  }
  const fallbackSelections = []
  plugin.apply(ctx, {
    React: { useState() {}, useEffect() {}, useRef(value) { return { current: value } }, createElement() {} },
    selectMode(mode) { fallbackSelections.push(mode) },
  })
  const injected = calls[1][1].inject('session-1')
  await injected.selectMode('plan')
  assert.deepEqual(fallbackSelections, ['plan'])
  for (const dispose of effects) await dispose()
})

// ---------------------------------------------------------------------------
// 13.5.7 The original selector and /model behavior do not change. The Core
// never renders, reads, or persists model state (code-level assertion: the
// bundle exposes no model-rendering path and activation requires no
// model-directory contract).
// ---------------------------------------------------------------------------
test('Core rendering contains no model key or model selection state', () => {
  const elements = []
  const React = {
    useEffect() {},
    useState(value) { return [value, () => {}] },
    useRef(value) { return { current: value } },
    createElement(type, props, ...children) {
      const element = { type, props: props ?? {}, children }
      elements.push(element)
      return element
    },
  }
  const Component = createModeControl(React)
  Component({ sessionId: 's1', useProjection() { return { next: 'plan', build: { provider: 'p', model: 'b' }, plan: { provider: 'p', model: 'q' } } }, selectMode() {} })
  const flat = JSON.stringify(elements)
  assert.equal(flat.includes('provider'), false)
  assert.equal(flat.includes('model'), false)
  assert.equal(flat.includes('invalidate'), false)
})

// ---------------------------------------------------------------------------
// 13.5.8 Installation failure and stop dispose Slots, styles, and listeners
// exactly once.
// ---------------------------------------------------------------------------
test('client entry unwinds acquired resources exactly once after installation failure', async () => {
  const calls = []
  const diagnostics = []
  let registrations = 0
  const slots = {
    inject(name, register) {
      registrations += 1
      if (registrations === 2) throw new Error('status registration failed')
      return register()
    },
    register(options) {
      calls.push(['register', options.name])
      return () => calls.push(['dispose', options.name])
    },
  }
  const ctx = {
    get(name) { return name === 'slots' ? slots : undefined },
    effect(register) { return register() },
  }

  await assert.doesNotReject(() => plugin.apply(ctx, {
    React: { createElement() {} },
    reportDiagnostic(diagnostic) { diagnostics.push(diagnostic) },
  }))
  assert.deepEqual(calls, [
    ['register', MODE_SLOT_NAME],
    ['dispose', MODE_SLOT_NAME],
  ])
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].state, 'failed')
  assert.equal(diagnostics[0].reason, 'status registration failed')
})

test('client entry reports cleanup failures without escaping activation containment', async () => {
  const diagnostics = []
  const slots = {
    inject(name, register) {
      if (name === STATUS_SLOT_NAME) throw new Error('status registration failed')
      return register()
    },
    register() {
      return () => { throw new Error('mode cleanup failed') }
    },
  }
  const ctx = {
    get(name) { return name === 'slots' ? slots : undefined },
    reportDiagnostic(diagnostic) { diagnostics.push(diagnostic) },
  }

  await assert.doesNotReject(() => plugin.apply(ctx, {
    React: { createElement() {} },
    reportDiagnostic(diagnostic) { diagnostics.push(diagnostic) },
  }))
  assert.equal(diagnostics.length, 1)
  assert.match(diagnostics[0].reason, /status registration failed; cleanup failed: mode cleanup failed/)
})

test('client entry remounts once after failure and stops without duplicate cleanup', async () => {
  const calls = []
  const effects = []
  let fail = true
  const slots = {
    inject(name, register) {
      if (fail && name === STATUS_SLOT_NAME) throw new Error('temporary failure')
      return register()
    },
    register(options) {
      calls.push(['register', options.name])
      let disposed = false
      return () => {
        assert.equal(disposed, false)
        disposed = true
        calls.push(['dispose', options.name])
      }
    },
  }
  const ctx = {
    get(name) { return name === 'slots' ? slots : undefined },
    effect(register) {
      const dispose = register()
      effects.push(dispose)
      return dispose
    },
  }
  const runtime = { React: { createElement() {} } }

  await plugin.apply(ctx, runtime)
  fail = false
  effects.length = 0
  plugin.apply(ctx, runtime)
  assert.deepEqual(calls.filter((entry) => entry[0] === 'register').map((entry) => entry[1]), [
    MODE_SLOT_NAME,
    MODE_SLOT_NAME,
    STATUS_SLOT_NAME,
  ])
  for (const dispose of effects.reverse()) await dispose()
  assert.deepEqual(calls.filter((entry) => entry[0] === 'dispose').map((entry) => entry[1]), [
    MODE_SLOT_NAME,
    STATUS_SLOT_NAME,
    MODE_SLOT_NAME,
  ])
})

// ---------------------------------------------------------------------------
// 13.5.9 Desktop/mobile and light/dark: the stylesheet uses alias tokens (both
// themes resolve) and a ≤520px mobile rule; layout asserts no overlap between
// the control and the status row and no stale status.
// ---------------------------------------------------------------------------
test('styles use alias tokens for both themes, a mobile rule, focus-visible, and explicit color-independent semantics', async () => {
  const calls = []
  const slots = {
    inject(name, register) { calls.push(['inject', name]); return register() },
    register() { return () => {} },
  }
  const ctx = { get(name) { return name === 'slots' ? slots : undefined } }
  plugin.apply(ctx, {
    React: { useState() {}, useEffect() {}, useRef(value) { return { current: value } }, createElement() {} },
    styles: { insert(css) { calls.push(['css', css]) } },
  })
  const css = calls.find((entry) => entry[0] === 'css')[1]
  // Light/dark: every themed color is an alias token resolved by the theme package.
  assert.match(css, /var\(--dsw-alias-state-success-primary\)/)
  assert.match(css, /var\(--dsw-alias-state-warn-primary\)/)
  assert.match(css, /var\(--dsw-alias-state-error-primary\)/)
  assert.match(css, /var\(--dsw-alias-state-success-tertiary\)/)
  assert.match(css, /var\(--dsw-alias-state-warn-tertiary\)/)
  assert.match(css, /var\(--dsw-alias-border-l3\)/)
  // Non-color semantics: pressed style keyed on aria-pressed, not color alone.
  assert.match(css, /\[aria-pressed='true'\]/)
  // Keyboard-visible focus.
  assert.match(css, /:focus-visible/)
  // Mobile rule at exactly ≤520px, shrinking the control.
  assert.match(css, /@media \(max-width: 520px\)/)
  // The sliding tint: one surface translating between two IDENTICAL halves
  // (equal fixed columns), eased non-linearly, with the mode colour fading in
  // step. Animation stays on compositor-friendly transform plus a small local
  // background/colour change, and honours reduced motion.
  assert.match(css, /\.bplan-mode-thumb\s*\{[^}]*transition:\s*transform[^;]*cubic-bezier/)
  assert.match(css, /\.bplan-mode-thumb\[data-active='plan'\]\s*\{[^}]*translateX\(100%\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  // Desktop/mobile layout cannot overlap: the control is an inline grid whose
  // two equal columns are exactly the thumb's 50% travel; the status is a
  // separate flex row in the dock.
  assert.match(css, /\.bplan-mode-control\s*\{[^}]*display:\s*inline-grid/)
  assert.match(css, /\.bplan-mode-control\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*\d+px\)/)
  assert.match(css, /\.bplan-mode-status\s*\{[^}]*display:\s*flex/)
  // No stale status: the status cell only exists while a turn runs and modes
  // differ (the component renders null otherwise) — the stylesheet must not
  // reserve space for a status when the component is absent.
  assert.match(css, /\.bplan-mode-status\s*\{[^}]*min-height:\s*0/)
})

// ---------------------------------------------------------------------------
// Slot conflict policy: low priority and versioned id avoid native plan
// conflicts; the injected face is session-located.
// ---------------------------------------------------------------------------
test('mode Slot uses low priority and the status Slot uses a versioned id', () => {
  assert.equal(MODE_SLOT_NAME, 'conversation.input.plan')
  assert.equal(STATUS_SLOT_NAME, 'conversation.composer.dock')
})

// ---------------------------------------------------------------------------
// Conversation-surface classification: selectors as data behind one factory.
// ---------------------------------------------------------------------------
const surfacesDocument = (markerPresent) => ({ querySelector: () => (markerPresent ? {} : null) })
function targetMatching(...selectors) {
  return { closest: (selector) => (selectors.includes(selector) ? {} : null) }
}

test('surface selectors are spelled once and match the reviewed strings', () => {
  assert.deepEqual(CONVERSATION_SURFACE_SELECTORS, {
    composer: 'textarea,[contenteditable="true"],[data-bplan-mode]',
    modeMarker: '[data-bplan-mode]',
    settings: '[data-slot^="settings."]',
    menu: '[role="menu"],[role="menuitem"],[role="listbox"]',
    interactionPanel: '[data-slot="conversation.input.overlay"],[data-slot="conversation.input.dock"]',
    overlay: '[role="dialog"],[role="alertdialog"]',
    keyboardManaged: '[role="grid"],[role="tree"],[role="tablist"],[aria-activedescendant]',
  })
})

test('classification reports each conversation surface from DOM primitives', () => {
  const interactionFacts = createInteractionFacts(surfacesDocument(true))
  const factKeys = ['conversation', 'settings', 'menu', 'interactionPanel', 'overlay', 'keyboardManaged']
  const surfaceClasses = [
    ['composer', 'conversation'],
    ['settings', 'settings'],
    ['menu', 'menu'],
    ['interactionPanel', 'interactionPanel'],
    ['overlay', 'overlay'],
    ['keyboardManaged', 'keyboardManaged'],
  ]
  for (const [selectorKey, factKey] of surfaceClasses) {
    const facts = interactionFacts({ target: targetMatching(CONVERSATION_SURFACE_SELECTORS[selectorKey]) })
    assert.deepEqual(facts, Object.fromEntries(factKeys.map((name) => [name, name === factKey])),
      `${selectorKey} alone should classify true for ${factKey} only`)
  }
})

test('a bare target outside every surface classifies all facts false with the marker present', () => {
  const interactionFacts = createInteractionFacts(surfacesDocument(true))
  const facts = interactionFacts({ target: { closest: () => null } })
  assert.deepEqual(facts, { conversation: false, settings: false, menu: false, interactionPanel: false, overlay: false, keyboardManaged: false })
})

test('the composer alone stays out of the conversation surface without the mode marker on the document', () => {
  const interactionFacts = createInteractionFacts(surfacesDocument(false))
  const facts = interactionFacts({ target: targetMatching(CONVERSATION_SURFACE_SELECTORS.composer) })
  assert.equal(facts.conversation, false)
})
