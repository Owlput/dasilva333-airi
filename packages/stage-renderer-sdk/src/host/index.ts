/**
 * The host half of the model driver contract, as one import.
 *
 * This subpath — `@proj-airi/stage-renderer-sdk/host` — is what an embedder's host side imports: the driver
 * registry, the cue broker and its transaction table, the live mount registry, the record/profile/prompt
 * stores behind one storage port, id minting, the backup and the service that turns all of it into the
 * operations a host process exposes. The package entry (`.`) stays contract and renderer adapter, so a
 * renderer bundle never pulls the host core in by importing the SDK.
 *
 * Two rules hold it together:
 *
 *   - **no DOM, no Vue, no Electron.** It is instantiated by Electron's main process, by the shared
 *     background window and by the in-process Web/Pocket host, so it may depend on none of them. Storage is a
 *     port, windows are a port, timers are injectable;
 *   - **the contract is the only vocabulary.** Every type it moves across a boundary comes from the contract
 *     in this same package, so there is exactly one definition of a cue, a mount descriptor or a failure
 *     code in the system.
 *
 * `@proj-airi/stage-renderer-sdk/testing` exports the stub driver and the harness. They are not part of a
 * production build, which is why they are a second subpath rather than part of this one.
 */
export * from './core/binding'
export * from './core/broker'
export * from './core/host'
export * from './core/ids'
export * from './core/keys'
export * from './core/mounts'
export * from './core/pointer'
export * from './core/prompt-service'
export * from './core/prompts'
export * from './core/records'
export * from './core/registry'
export * from './core/storage'
export * from './loaders'
export * from './logging'
export * from './service'
export * from './speech'
