/**
 * The state channel between AIRI and a model driver — and nothing else.
 *
 * Owner: the host implements this; the renderer is the only writer of its own state.
 *
 * **AIRI does not know a renderer's storage.** It is never told which keys exist, what shape their
 * values have, which of them are worth backing up, or how an older value becomes a newer one. A
 * renderer that reports those is reporting its internals, and the report goes stale the moment the
 * renderer changes.
 *
 * What AIRI provides instead is primitives: `services.storage` for the renderer's own key/value state,
 * and this port for the one per-model slice the host has to hold — because prompts and the catalog are
 * built while nothing is mounted. A renderer's whole state moves as a single opaque bundle
 * (`ModelDriverTransferBundle` in `renderer.ts`), and patching and migrating it are the renderer's own
 * business.
 */
import type { CapabilityVocabularySnapshot } from './capabilities'
import type { ModelId, ModelProfileId } from './model'
import type { ModelDriverId, RendererMountSurfaceKind } from './shared'

/**
 * The state of one **state scope** and its model, kept by the host as an uninterpreted snapshot.
 *
 * Scope: a scope — not the model, and not the mount. A scope is AIRI's unit of sharing: every mount in
 * a scope reads and writes the same state, a scope outlives any particular mount, and one scope is one
 * record — the scope is the whole key, which is why `readSnapshot` names nothing else.
 *
 * It has to be the host that defines the sharing, because the renderer may not be told the policy:
 * the renderer only ever learns the scope name it is handed, and that policy may change without
 * touching this contract.
 */
export interface ModelScopedState {
  /**
   * The state scope this snapshot belongs to — the whole key.
   *
   * Comes from `RendererMountProps.stateScope`: a mount echoes the name it was given, and never
   * invents, stores or interprets one.
   */
  stateScope: string
  /**
   * The surface whose mount wrote this snapshot most recently.
   *
   * A **label, not a key**. One surface can hold several scopes (every preview mount has its own) and
   * a scope outlives any particular mount, so this cannot identify a record. The host needs it after a
   * restore, when it holds records but no running mounts: it is how the host tells the shared scopes —
   * the ones AIRI may read for prompts — from the ones belonging to a single mount, which can be
   * discarded.
   */
  surface: RendererMountSurfaceKind
  modelId: ModelId
  modelDriverId: ModelDriverId
  /**
   * The renderer's own per-model values, in whatever shape it likes.
   *
   * Opaque to AIRI: stored, moved and handed back verbatim, and tolerated verbatim when a newer
   * renderer reads what an older one wrote. There is no declared key list to validate against.
   */
  values: Record<string, unknown>
  /**
   * The token vocabulary AIRI may put in a prompt, written by the renderer together with `values` and
   * read-only for AIRI.
   *
   * Required rather than optional: two different facts — "this renderer has no vocabulary to offer"
   * and "no vocabulary has been written yet" — would otherwise be the same `undefined`, and a prompt
   * builder cannot act on an ambiguity. An empty `items` is how a renderer states the first of them.
   * `capabilities.ts` describes the list's stability requirement.
   */
  vocabulary: CapabilityVocabularySnapshot
  /**
   * The profile this model is showing, written by the mounted renderer and read-only for AIRI.
   *
   * AIRI has to name a profile when it wants a specific one (`LoadCue.profileId`), and it has to
   * highlight the current one in a quick switch — both without asking a renderer at runtime and without
   * keeping a mirror of state it does not own. This snapshot *is* that mirror.
   *
   * Row-required, and never empty for a model that is mounted: AIRI mints a default `profileId` before
   * the model is imported, so a mounted model always has at least one profile to report.
   */
  profileId: ModelProfileId
  /** Monotonic, bumped by the renderer on every write. AIRI never writes it. */
  revision: number
  updatedAt: number
}

/**
 * The state channel's two verbs, handed to the plugin as `ModelDriverHostServices.state`.
 *
 * A snapshot has to be readable while nothing is mounted, which is why this is a service and not a
 * member of the mount. It is deliberately the *only* state AIRI holds: a renderer's other keys are its
 * own, reached through `HostStorageInterface`, and its whole state travels as one opaque bundle
 * (`ModelDriverRuntime.export` / `import`).
 *
 * Rules:
 *   - a scope name is **opaque** to the renderer and is never interpreted. AIRI mints it under a
 *     reserved prefix and never lets it equal a `RendererMountSurfaceKind` value, so the scope
 *     namespace and the surface namespace stay distinguishable and a renderer cannot learn the sharing
 *     policy by reading names.
 *   - a scope is **not a mount's identity**: several mounts can share one scope, so anything addressed
 *     to *one* mount names its `mountId` instead (`RendererMountProps.mountId`). This record is keyed
 *     by the scope, because it is the sharing unit and not the mount.
 *   - a scope's name is **stable while its state lives**. Renaming orphans the records, so the host
 *     either migrates them with the rename or discards them deliberately; it never leaves a renderer
 *     reading an empty scope and concluding the model has no state.
 *   - a scope that belongs to a **single mount** is unique to that mount and is discarded when it
 *     unmounts: nothing else can read it, and keeping it would let a later preview inherit a draft.
 *   - the **renderer is the only writer**. The host keeps the latest snapshot and never writes one back
 *     into renderer storage; restoring hands the renderer the complete snapshot the host holds, and the
 *     renderer decides what to keep.
 *   - **every hand-over is the complete state**, never a patch or a delta, and never a per-value
 *     negotiation: patching and migrating are the renderer's own business, because only it knows the
 *     shape of what it stored.
 *   - `values` stays opaque to AIRI, so the renderer may put its per-model transform, selection and
 *     morph overrides in there under its own keys.
 *   - `vocabulary` and `profileId` are the two parts AIRI reads. For those, AIRI reads a **shared**
 *     scope — the live stage's first — and never a single-mount one: otherwise a draft the user is
 *     still trying in a preview would become what a prompt believes the model looks like. This is a
 *     host-side read, not a port method; prompts and the catalog are built while nothing is mounted.
 */
export interface HostStateTransferPort {
  /**
   * Store a snapshot the renderer just produced, into the scope its mount belongs to.
   *
   * Any **mounted** instance may call this: what it publishes goes into its own `stateScope`, so mounts
   * that share a scope publish into one state, and a preview's draft never lands in the stage's. A
   * settings panel edits the renderer's own store and lets the mount of its scope publish. If nothing is
   * mounted, nothing writes — a panel's edits land in that scope's snapshot the next time one of its
   * mounts is up.
   *
   * Publish what the model *is*, not what the user is currently trying. An unconfirmed change belongs to
   * a `persistent: false` cue and MUST NOT reach here: this snapshot is also what AIRI reads to build
   * prompts.
   *
   * The host keeps the snapshot verbatim and never writes it back into renderer storage; it ignores a
   * write that is not newer than the one it already holds for that scope, and a write naming a scope it
   * never minted for a live mount.
   */
  writeSnapshot: (snapshot: ModelScopedState) => Promise<void>
  /**
   * The snapshot AIRI holds for one state scope.
   *
   * The scope is the whole key. The host mints one per snapshot it keeps, and anything else a caller
   * could name — the renderer, the model — is either already fixed by which mount is asking or is data
   * inside the snapshot it gets back. A mount passes the `stateScope` it was handed and does not read
   * another scope's state: that is what keeps a preview a preview, instead of it inheriting the stage's
   * working state.
   *
   * Reading it is how a renderer picks itself up after a device move or a remount. It receives the
   * complete snapshot the host holds, not a diff, and decides for itself what to keep and how to migrate
   * what it does not recognise.
   */
  readSnapshot: (stateScope: string) => Promise<ModelScopedState | undefined>
}
