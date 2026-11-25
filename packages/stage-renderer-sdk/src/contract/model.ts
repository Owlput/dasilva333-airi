/**
 * The identities that address a model, its profile, and the character that points at them.
 *
 * Owner: AIRI. A model driver receives `modelId` and `profileId` and treats both as opaque keys.
 */

/**
 * Identity of a model.
 *
 * Minted by AIRI's **Adapter** before the model is imported (`Adapter.mintModelId`): it is the value
 * the reference to that model is stored under, and it is discarded when the import is abandoned. The
 * Adapter — not the driver, and not the character card — guarantees uniqueness, because the Adapter
 * is the one side that sees every import in flight in a window.
 *
 * On the migration path the id is minted **fresh** and the legacy `DisplayModel.id` is kept only as
 * provenance inside the driver's retained handover (D4, D18): AIRI never adopts a legacy id as a new
 * identity, and the frozen `modules.displayModelId` on a card keeps naming the legacy value.
 *
 * A driver MUST persist the model under exactly the value it is handed and MUST NOT invent or
 * rewrite one: a second identity for the same asset is an asset AIRI can never address again.
 * A package, a backup, a restore and a device transfer *preserve* the ids they carry instead
 * (D18) — minting is for new identities only.
 */
export type ModelId = string

/**
 * Identity of a model profile.
 *
 * Minted by AIRI's Adapter under the same rule as `ModelId` (`Adapter.mintProfileId`): before the
 * model is imported (that is the model's default profile) or before `ModelProvider.saveProfile` for
 * any other one.
 */
export type ModelProfileId = string

/**
 * Identity of a character — the thing that points at a model.
 *
 * AIRI's own identity, and the only one of the three a driver never receives as a key: a mount and
 * a model picker are told which character they are serving, so a driver can scope its own UI
 * without learning AIRI's character records.
 */
export type CharacterId = string

/**
 * Which state a model is in, on both sides of the boundary at once.
 *
 * The state decides who may enumerate and reference a model, so it is the whole of the import
 * question — and there is one of these values per model, not one per side:
 *
 * | state        | AIRI enumerates | AIRI references | driver enumerates | driver references |
 * | :----------- | :-------------- | :-------------- | :---------------- | :---------------- |
 * | `unimported` | no              | no              | no                | no                |
 * | `builtin`    | no              | no              | yes               | yes               |
 * | `imported`   | yes             | yes             | yes               | yes               |
 *
 * All of them persist; a model is never observed mid-import as a fourth value.
 *
 * The one thing an import could describe as "not yet committed" — a payload the user has not
 * confirmed — is **not a model state**. It has no `modelId`, so it is not addressable and never
 * becomes one until it is imported; AIRI keeps it as `PendingModelPayload` (`references.ts`).
 * Modelling that as a state would mean a reference could name something neither side can serve,
 * which is exactly what the contract refuses.
 */
export type ModelState
  = /** Neither side can reach it. It may be a file on disk; as far as the contract goes, it is not a model. */
    | 'unimported'
  /**
   * The driver ships it and can enumerate/reference it; AIRI cannot.
   *
   * A preset, a bundled sample, a driver-side "create a default model" action. It is a real model to
   * the driver and invisible to AIRI, which is why it must be imported before a character card may
   * point at it: a card that named one would hold a key only one side understands.
   */
    | 'builtin'
  /** Imported: both sides enumerate and reference it under the Adapter-minted ids. */
    | 'imported'
