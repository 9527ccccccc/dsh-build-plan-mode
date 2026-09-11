import { BPLAN_CONTRACT } from './contract.js'
import { drainDisposers } from './disposer-drain.js'

export const MODE_SLOT_NAME = 'conversation.input.plan'
export const STATUS_SLOT_NAME = 'conversation.composer.dock'
export const MODE_PROJECTION_KEY = BPLAN_CONTRACT.projection.key

const MODES = ['build', 'plan']

export function isMode(value) {
  return value === 'build' || value === 'plan'
}

export function shouldToggleMode(event, interaction) {
  return event.key === 'Tab'
    && event.shiftKey !== true
    && event.altKey !== true
    && event.ctrlKey !== true
    && event.metaKey !== true
    && event.isComposing !== true
    && event.defaultPrevented !== true
    && event.repeat !== true
    && interaction.conversation === true
    && interaction.settings !== true
    && interaction.menu !== true
    && interaction.interactionPanel !== true
    && interaction.overlay !== true
    && interaction.keyboardManaged !== true
}

export function installKeyboardAdapter({ target, interactionFacts, modeView, selectMode }) {
  if (target === undefined || typeof target.addEventListener !== 'function') return () => {}
  const onKeyDown = (event) => {
    const interaction = typeof interactionFacts === 'function' ? interactionFacts(event) : { conversation: false }
    const view = typeof modeView === 'function' ? modeView() : { available: false }
    if (!shouldToggleMode(event, interaction) || !view.available || typeof selectMode !== 'function') return
    event.preventDefault()
    Promise.resolve(selectMode(view.next === 'build' ? 'plan' : 'build')).catch(() => {})
  }
  target.addEventListener('keydown', onKeyDown)
  return () => target.removeEventListener('keydown', onKeyDown)
}

export function modeViewModel(projection) {
  if (projection === undefined || projection === null || !isMode(projection.next)) {
    return { available: false, next: null, current: null }
  }
  const current = projection.current !== null
    && projection.current !== undefined
    && isMode(projection.current.mode)
    ? projection.current.mode
    : null
  return { available: true, next: projection.next, current }
}

function modeLabel(mode) {
  return mode === 'build' ? 'Build' : 'Plan'
}

// Outline glyphs drawn on a 14px grid with the host's 1.5px stroke, but each
// cropped to its own ink box (stroke allowance included). A padded 14x14
// viewBox made the flex row measure phantom padding, so the icon's empty left
// margin read as extra space before the glyph while the label sat tight
// against the right edge.
const MODE_ICONS = Object.freeze({
  build: { d: 'M3 7.5 5.75 10.25 11 4.5', viewBox: '2.25 3.75 9.5 7.25', width: 9.5, height: 7.25 },
  plan: { d: 'M3.5 4.5h7.5M3.5 7h7.5M3.5 9.5h5', viewBox: '2.75 3.75 9 6.5', width: 9, height: 6.5 },
})

function modeIcon(React, mode) {
  const icon = MODE_ICONS[mode]
  return React.createElement('svg', {
    className: `bplan-mode-icon bplan-mode-icon-${mode}`,
    viewBox: icon.viewBox,
    width: icon.width,
    height: icon.height,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    focusable: false,
    'aria-hidden': true,
  }, React.createElement('path', { d: icon.d }))
}

export function createModeControl(React, runtime = {}) {
  return function ModeControl({ sessionId, useProjection, locked = false, selectMode }) {
    const projection = useProjection(MODE_PROJECTION_KEY)
    const view = modeViewModel(projection)
    React.useEffect(() => installKeyboardAdapter({
      target: runtime.keyTarget,
      interactionFacts: runtime.interactionFacts,
      modeView: () => view,
      selectMode,
    }), [view.available, view.next, selectMode])
    const [pending, setPending] = React.useState(false)
    const [error, setError] = React.useState(null)
    const alive = React.useRef(true)

    React.useEffect(() => {
      alive.current = true
      return () => { alive.current = false }
    }, [])

    const select = (mode) => {
      if (!view.available || locked || pending || mode === view.next || typeof selectMode !== 'function') return
      setPending(true)
      setError(null)
      Promise.resolve(selectMode(mode)).then((failure) => {
        if (!alive.current) return
        setPending(false)
        setError(typeof failure === 'string' && failure.length > 0 ? failure : null)
      }, (reason) => {
        if (!alive.current) return
        setPending(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    }

    const unavailable = !view.available || typeof selectMode !== 'function'
    return React.createElement('span', {
      className: 'bplan-mode-wrap',
      title: 'Next message mode. Press Tab in the conversation to switch.',
    },
      React.createElement('span', {
        className: 'bplan-mode-control',
        role: 'group',
        'aria-label': 'Next message mode',
      },
      // The sliding tint lives in its own element so a mode change animates one
      // surface across the control (transform + background-color) instead of
      // snapping each button's own background between two fixed sides.
      React.createElement('span', {
        className: 'bplan-mode-thumb',
        'data-active': view.available ? view.next : 'none',
        'aria-hidden': true,
      }),
      ...MODES.map((mode) => React.createElement('button', {
        key: mode,
        type: 'button',
        className: `bplan-mode-button bplan-mode-${mode}`,
        disabled: unavailable || locked || pending,
        'aria-label': `${modeLabel(mode)} mode for the next message`,
        'aria-pressed': view.available && view.next === mode,
        [BPLAN_CONTRACT.projection.attribute]: mode,
        onClick: () => select(mode),
      }, modeIcon(React, mode), React.createElement('span', null, modeLabel(mode))))),
      unavailable
        ? React.createElement('span', { className: 'bplan-mode-error', role: 'status' }, 'Mode unavailable')
        : error === null ? null : React.createElement('span', { className: 'bplan-mode-error', role: 'status', title: error }, 'Mode change failed'),
    )
  }
}

export function createModeStatus(React) {
  return function ModeStatus({ useProjection, useSession }) {
    const view = modeViewModel(useProjection(MODE_PROJECTION_KEY))
    const running = useSession((snapshot) => snapshot.running) === true
    if (!view.available || !running || view.current === null || view.current === view.next) return null
    return React.createElement('div', { className: 'bplan-mode-status', role: 'status' },
      React.createElement('span', null, 'Current ', React.createElement('strong', null, modeLabel(view.current))),
      React.createElement('span', { 'aria-hidden': true }, '\u2192'),
      React.createElement('span', null, 'Next ', React.createElement('strong', null, modeLabel(view.next))),
    )
  }
}

function optionalClientService(ctx, name) {
  if (Object.hasOwn(ctx, name)) return ctx[name]
  if (typeof ctx.get !== 'function') return undefined
  try { return ctx.get(name) } catch { return undefined }
}

function reportActivation(ctx, runtime, diagnostic) {
  const packageVersion = runtime.packageVersion ?? optionalClientService(ctx, 'packageVersion')
  const reported = packageVersion === undefined ? diagnostic : { ...diagnostic, packageVersion }
  const reporter = runtime.reportDiagnostic ?? runtime.onDiagnostic
  try {
    if (typeof reporter === 'function') {
      reporter(reported)
      return
    }
    optionalClientService(ctx, 'logger')?.warn?.(`build-plan-mode client ${diagnostic.state}: ${diagnostic.reason}`)
  } catch {
    // Diagnostics must never turn optional plugin failure into app failure.
  }
}

function activationError(error) {
  return error instanceof Error ? error.message : String(error)
}

export const PLUGIN_PACKAGE_ID = '@local/dsh-build-plan-mode-v2'

/**
 * The conversation-surface definition, spelled once as data: what the
 * keyboard adapter treats as composer, settings, menus, panels, overlays,
 * and other keyboard-managed territory.
 */
export const CONVERSATION_SURFACE_SELECTORS = {
  composer: `textarea,[contenteditable="true"],[${BPLAN_CONTRACT.projection.attribute}]`,
  modeMarker: `[${BPLAN_CONTRACT.projection.attribute}]`,
  settings: '[data-slot^="settings."]',
  menu: '[role="menu"],[role="menuitem"],[role="listbox"]',
  interactionPanel: '[data-slot="conversation.input.overlay"],[data-slot="conversation.input.dock"]',
  overlay: '[role="dialog"],[role="alertdialog"]',
  keyboardManaged: '[role="grid"],[role="tree"],[role="tablist"],[aria-activedescendant]',
}

/** Classify an event's surface from injected DOM primitives. */
export function createInteractionFacts(documentRef) {
  return function interactionFacts(event) {
    const target = event?.target
    const closest = typeof target?.closest === 'function' ? (selector) => target.closest(selector) : () => null
    const composerTarget = closest(CONVERSATION_SURFACE_SELECTORS.composer) !== null
    return {
      conversation: composerTarget && documentRef.querySelector(CONVERSATION_SURFACE_SELECTORS.modeMarker) !== null,
      settings: closest(CONVERSATION_SURFACE_SELECTORS.settings) !== null,
      menu: closest(CONVERSATION_SURFACE_SELECTORS.menu) !== null,
      interactionPanel: closest(CONVERSATION_SURFACE_SELECTORS.interactionPanel) !== null,
      overlay: closest(CONVERSATION_SURFACE_SELECTORS.overlay) !== null,
      keyboardManaged: closest(CONVERSATION_SURFACE_SELECTORS.keyboardManaged) !== null,
    }
  }
}

/**
 * Production assembly of the entrypoint's environment knobs from the module
 * loader context. The knob bag shape stays the single contract between this
 * adapter and the hand-built bags the test suite assembles across the same
 * apply seam.
 */
export function createProductionRuntime(ctx, { React, window, document }) {
  return {
    React,
    styles: {
      insert(css) {
        const tag = document.createElement('style')
        tag.dataset.pluginCss = PLUGIN_PACKAGE_ID
        tag.textContent = css
        document.head.appendChild(tag)
        return () => tag.remove()
      },
    },
    keyTarget: window,
    commandExecute: (sessionId, line) => ctx.remote.commands.execute(sessionId, line, []),
    interactionFacts: createInteractionFacts(document),
  }
}

export function apply(ctx, runtime = {}) {
  const slots = ctx.get('slots')
  const styles = runtime.styles
  const React = runtime.React
  if (slots === undefined || React === undefined) return

  const capabilities = ['slots', 'react']
  const selectMode = runtime.selectMode
  const selectForSession = (sessionId) => runtime.commandExecute === undefined
    ? selectMode
    : async (mode) => {
        // rc2 commands.execute settles as `undefined` (syntax/unknown name) or
        // `{ commandId, result: { kind: 'success'|'error', text? } }`.
        const outcome = await runtime.commandExecute(sessionId, `/${BPLAN_CONTRACT.commands.interactive} ${mode}`)
        if (outcome === undefined) return 'Build / Plan command unavailable'
        if (outcome.result?.kind === 'error') return outcome.result.text || 'Mode change failed'
        return null
      }
  const disposers = []
  const install = (register) => {
    const dispose = register()
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  let rollbackTask
  const rollback = () => rollbackTask ??= drainDisposers(disposers)
  try {
    install(() => slots.inject(MODE_SLOT_NAME, () => slots.register(
      { name: MODE_SLOT_NAME, priority: -20, inject: (sessionId) => ({ sessionId, selectMode: selectForSession(sessionId) }) },
      createModeControl(React, runtime),
    )))
    install(() => slots.inject(STATUS_SLOT_NAME, () => slots.register(
      { name: STATUS_SLOT_NAME, id: 'build-plan-mode-v2', order: 20 },
      createModeStatus(React),
    )))

    if (styles !== undefined && typeof styles.insert === 'function') {
      install(() => styles.insert(`
.bplan-mode-wrap { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.bplan-mode-control { position: relative; display: inline-grid; grid-template-columns: repeat(2, 72px); align-items: stretch; padding: 0; border: 0; background: transparent; }
.bplan-mode-thumb { position: absolute; top: 0; bottom: 0; left: 0; width: 50%; border-radius: 999px; background: transparent; transition: transform 180ms cubic-bezier(.22, 1, .36, 1), background-color 180ms cubic-bezier(.22, 1, .36, 1); }
.bplan-mode-thumb[data-active='build'] { background: var(--dsw-alias-state-success-tertiary); }
.bplan-mode-thumb[data-active='plan'] { transform: translateX(100%); background: var(--dsw-alias-state-warn-tertiary); }
.bplan-mode-button { position: relative; z-index: 1; height: 28px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 999px; padding: 0 12px; color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer; font: inherit; font-size: 13px; font-weight: 500; line-height: 20px; letter-spacing: 0; white-space: nowrap; transition: color 180ms cubic-bezier(.22, 1, .36, 1); }
.bplan-mode-button:hover:not(:disabled):not([aria-pressed='true']) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.bplan-mode-button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-border-l3); }
.bplan-mode-button:disabled { cursor: default; color: var(--dsw-alias-label-dimmed); }
.bplan-mode-build[aria-pressed='true'] { color: var(--dsw-alias-state-success-primary); font-weight: 600; }
.bplan-mode-plan[aria-pressed='true'] { color: var(--dsw-alias-state-warn-primary); font-weight: 600; }
.bplan-mode-icon { flex: none; display: block; }
.bplan-mode-error { max-width: 110px; overflow: hidden; color: var(--dsw-alias-state-error-primary); font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.bplan-mode-status { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-height: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
.bplan-mode-status strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
@media (max-width: 520px) { .bplan-mode-control { grid-template-columns: repeat(2, 64px); } .bplan-mode-button { padding-inline: 6px; } }
@media (prefers-reduced-motion: reduce) { .bplan-mode-thumb, .bplan-mode-button { transition: none; } }
      `))
    }
  } catch (error) {
    return rollback().then((cleanupErrors) => reportActivation(ctx, runtime, {
      state: 'failed',
      half: 'client',
      capabilities,
      reason: cleanupErrors.length === 0
        ? activationError(error)
        : `${activationError(error)}; cleanup failed: ${cleanupErrors.map(activationError).join('; ')}`,
    }))
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => rollback, 'build-plan-mode activation')
  }

}

export default {
  name: 'build-plan-mode-client',
  apply,
}
