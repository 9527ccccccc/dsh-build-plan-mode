// Wire identity contract shared by the Node host half and the browser client half.
// Sole spelling site for every fact both runtimes must agree on. Dependency-free,
// browser-safe, deeply frozen, JSON-safe: scripts/build.mjs embeds the serialized
// object verbatim into the generated client bundle.
export const BPLAN_CONTRACT = Object.freeze({
  projection: Object.freeze({
    key: 'bplanMode',
    attribute: 'data-bplan-mode',
  }),
  commands: Object.freeze({
    interactive: 'bplan',
    state: 'bplan-state',
  }),
})
