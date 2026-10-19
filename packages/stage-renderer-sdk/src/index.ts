/**
 * `@proj-airi/stage-renderer-sdk` — the contract between AIRI and a model driver.
 *
 * Status: **contract only, not integrated**. Nothing in this workspace imports this package yet; it
 * exists so the boundary can be reviewed before any code moves behind it. See `README.md` for the
 * ownership rules and the file map, and `docs/rfcs/0001-stage-renderer-plugin-contract.md` for why
 * the contract has this shape.
 *
 * Every closed vocabulary is an `enum`, so its members are named, documented and exhaustively
 * checkable where a consumer switches on one; `MODEL_DRIVER_CONTRACT_VERSION` is the only other
 * value. Everything else is a type.
 *
 * AIRI owns the **named model** and its **profiles** as records: the id a character card points at, the
 * user's annotations, and a stored preview. The model driver owns the **raw model** (the bytes, its
 * format's validation and repair), the **model** it drives, the **renderer** that draws it, its storage
 * layout, its migrations and its capability record. AIRI never assumes one driver's model means the
 * same thing to another.
 */

export * from './contract/capabilities'
export * from './contract/cues'
export * from './contract/host-services'
export * from './contract/lifecycle'
export * from './contract/manifest'
export * from './contract/model'
export * from './contract/persistence'
export * from './contract/provider'
export * from './contract/references'
export * from './contract/renderer'
export * from './contract/renderer-mount'
export * from './contract/shared'
