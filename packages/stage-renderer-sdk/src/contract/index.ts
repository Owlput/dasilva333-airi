/**
 * The contract, in one import.
 *
 * `src/index.ts` is the package's public entry and also exports the renderer adapter; code *inside* the
 * package must not import that entry, because the entry imports `host/` and a core module importing it back
 * would be a cycle. This barrel exists for those internal consumers: the host core, the host service and the
 * fixtures take their vocabulary from here, and it carries exactly the contract and nothing that runs.
 *
 * It deliberately does not reach into `validate.ts` or `compatibility.ts`. Those are code, not vocabulary, so
 * a module that needs them imports them by name and the dependency stays visible.
 */
export * from './adapter'
export * from './capabilities'
export * from './components'
export * from './cues'
export * from './host-services'
export * from './lifecycle'
export * from './manifest'
export * from './migration'
export * from './model'
export * from './plugin-port'
export * from './provider'
export * from './references'
export * from './registry'
export * from './renderer-mount'
export * from './shared'
