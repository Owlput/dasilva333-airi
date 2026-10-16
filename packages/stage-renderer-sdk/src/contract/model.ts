/**
 * The two identities AIRI mints: the model reference and its profile.
 *
 * Owner: AIRI. A model driver receives both and treats them as opaque keys.
 */

/**
 * Identity of a model.
 *
 * AIRI MUST create it before a model is imported: it is the value the reference to that
 * model is stored under, and it is discarded when the import fails. Today it is the card's
 * `displayModelId`, e.g. `display-model-<nanoid>`.
 */
export type ModelId = string

/**
 * Identity of a model profile.
 *
 * AIRI MUST create it before the model is imported — that is the model's default profile —
 * or before `ModelProvider.saveProfile` for any other one. It persists as the reference to
 * that profile, or is discarded otherwise.
 */
export type ModelProfileId = string
