/**
 * `@proj-airi/stage-renderer-sdk` — the contract between AIRI and a model driver.
 *
 * Status: **contract only, not integrated**. Nothing in this workspace imports this package; it
 * exists so the boundary can be reviewed before any code moves behind it, and it is at `0.1`, the
 * first shipped contract shape (Phase 0 of `IMPLEMENTATION_PLAN.md`). See `README.md` for the
 * ownership rules and the file map, `DECISIONS-PHASE0.md` for the choices the contract itself makes,
 * and [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md) for
 * why the contract has this shape.
 *
 * Every closed vocabulary is an `enum`, so its members are named, documented and exhaustively
 * checkable where a consumer switches on one. The runtime values this package exports are exactly the
 * ones a host or a driver has to read at a boundary — the contract revision, the declared readiness
 * transitions, the withdrawal bounds, the capability key set — plus the validators in `validate.ts`
 * and the compatibility predicate in `compatibility.ts`. Everything else is a type.
 *
 * AIRI owns the **named model** and its **profiles** as records: the id a character card points at, the
 * user's annotations, who made the model, and a stored preview. The model driver owns the **raw model**
 * (the bytes, its format's validation and repair), the **model** it drives, the **renderer** that draws
 * it, its storage layout, its migrations and its capability record.
 */

export * from './compatibility'
export * from './contract/adapter'
export * from './contract/capabilities'
export * from './contract/components'
export * from './contract/cues'
export * from './contract/host-services'
export * from './contract/lifecycle'
export * from './contract/manifest'
export * from './contract/migration'
export * from './contract/model'
export * from './contract/plugin-port'
export * from './contract/provider'
export * from './contract/references'
export * from './contract/registry'
export * from './contract/renderer-mount'
export * from './contract/shared'
export * from './validate'
