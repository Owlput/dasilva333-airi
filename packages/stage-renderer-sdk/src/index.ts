/**
 * `@proj-airi/stage-renderer-sdk` — the contract between AIRI and a stage
 * renderer plugin.
 *
 * Status: **types only, not integrated**. Nothing in this workspace imports this
 * package yet; it exists so the boundary can be reviewed before any code moves
 * behind it. See `README.md` for the ownership rules and the file map.
 *
 * The one rule everything else follows: **AIRI owns references, the renderer owns
 * assets.** AIRI stores a name, a card binding, tags, mappings and a preview
 * snapshot; the renderer owns the bytes, its format's validation and repair, its
 * preview generation, and its capability enumeration. AIRI never assumes one
 * renderer's asset means the same thing to another renderer.
 */

export * from './contract/assets'
export * from './contract/capabilities'
export * from './contract/cues'
export * from './contract/host-services'
export * from './contract/lifecycle'
export * from './contract/manifest'
export * from './contract/persistence'
export * from './contract/references'
export * from './contract/shared'
export * from './contract/stage'
