window.__ModuleLoader__.load({
  id: "@local/dsh-build-plan-mode-v2",
  factory: (require) => {
    const module = { exports: {} }
    const BPLAN_CONTRACT = {"projection":{"key":"bplanMode","attribute":"data-bplan-mode"},"commands":{"interactive":"bplan","state":"bplan-state"}}
    const React = require('react')
    require('@deepseek-ai/dsh-api-remotes')
    /**
     * Single owner of the plugin's uninstall sequence: collect disposers, run
     * them in reverse installation order exactly once, contain every failure,
     * and hand back the collected errors. Sync throws and returned thenables
     * are contained alike; each disposer settles before the next starts.
     *
     * Consumes the caller's array (`splice(0)`), so a repeated invocation
     * drains nothing — exactly-once pairs with the caller's task memoization.
     */
    function drainDisposers(disposers) {
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


    const MODE_SLOT_NAME = 'conversation.input.plan'
    const STATUS_SLOT_NAME = 'conversation.composer.dock'
    const MODE_PROJECTION_KEY = BPLAN_CONTRACT.projection.key

    const MODES = ['build', 'plan']

    function isMode(value) {
      return value === 'build' || value === 'plan'
    }

    function shouldToggleMode(event, interaction) {
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

    function installKeyboardAdapter({ target, interactionFacts, modeView, selectMode }) {
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

    function modeViewModel(projection) {
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

    function modeIcon(React, mode) {
      return React.createElement('span', {
        className: `bplan-mode-icon bplan-mode-icon-${mode}`,
        'aria-hidden': true,
      }, mode === 'build' ? '\u2713' : '\u2630')
    }

    function createModeControl(React, runtime = {}) {
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
          }, ...MODES.map((mode) => React.createElement('button', {
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

    function createModeStatus(React) {
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

    const PLUGIN_PACKAGE_ID = '@local/dsh-build-plan-mode-v2'

    /**
     * The conversation-surface definition, spelled once as data: what the
     * keyboard adapter treats as composer, settings, menus, panels, overlays,
     * and other keyboard-managed territory.
     */
    const CONVERSATION_SURFACE_SELECTORS = {
      composer: `textarea,[contenteditable="true"],[${BPLAN_CONTRACT.projection.attribute}]`,
      modeMarker: `[${BPLAN_CONTRACT.projection.attribute}]`,
      settings: '[data-slot^="settings."]',
      menu: '[role="menu"],[role="menuitem"],[role="listbox"]',
      interactionPanel: '[data-slot="conversation.input.overlay"],[data-slot="conversation.input.dock"]',
      overlay: '[role="dialog"],[role="alertdialog"]',
      keyboardManaged: '[role="grid"],[role="tree"],[role="tablist"],[aria-activedescendant]',
    }

    /** Classify an event's surface from injected DOM primitives. */
    function createInteractionFacts(documentRef) {
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
    function createProductionRuntime(ctx, { React, window, document }) {
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

    function apply(ctx, runtime = {}) {
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
    .bplan-mode-control { display: inline-grid; grid-template-columns: repeat(2, minmax(58px, 1fr)); align-items: center; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); }
    .bplan-mode-button { min-width: 58px; height: 28px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: 0; border-radius: 4px; padding: 0 8px; color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer; font: inherit; font-size: 12px; line-height: 1; letter-spacing: 0; white-space: nowrap; }
    .bplan-mode-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
    .bplan-mode-button:disabled { cursor: default; opacity: .6; }
    .bplan-mode-build[aria-pressed='true'] { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-bg-layer-2); font-weight: 600; }
    .bplan-mode-plan[aria-pressed='true'] { color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-2); font-weight: 600; }
    .bplan-mode-icon { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
    .bplan-mode-error { max-width: 110px; overflow: hidden; color: var(--dsw-alias-state-error-primary); font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
    .bplan-mode-status { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-height: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
    .bplan-mode-status strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
    @media (max-width: 520px) { .bplan-mode-control { grid-template-columns: repeat(2, minmax(52px, 1fr)); } .bplan-mode-button { min-width: 52px; padding-inline: 6px; } }
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


    module.exports.inject = ['slots', 'remote', 'remote.commands']
    module.exports.apply = (ctx) => apply(ctx, createProductionRuntime(ctx, { React, window, document }))
    return module.exports
  },
})
