/**
 * The adapter: the one host object a renderer window holds, and the endpoint of every transaction.
 *
 * Owner: AIRI implements it, one per renderer window. It is the place where the three authorities
 * that must not be duplicated actually live:
 *
 *   - **identity.** The adapter mints `modelId` and `profileId` (`mintModelId`, `mintProfileId`) and
 *     guarantees uniqueness, because it is the one side that sees every import in flight in its
 *     window. It never adopts a legacy identity: a migrated model gets a fresh id and the old one
 *     survives only as provenance (`D4`, `D18`).
 *   - **mount identity.** It does **not** mint mount ids. The registry issues them
 *     (`HostRegistryClient.registerMount`) and a renderer cannot construct one, which is what makes a
 *     forged mount address inexpressible rather than merely forbidden. There is deliberately no
 *     `mintMountId` here.
 *   - **entry resolution.** It asks the manager which module to load (`requestEntrypoint`) and imports
 *     what the manager named through its own build-time loader table. The adapter makes no entry
 *     decision of its own.
 *
 * It is also the **endpoint** of the cue path: it emits envelopes, and the broker delivers settlements
 * to it — including `NO_TARGET`, which is the broker's decision and never the adapter's.
 */
import type { CueChannel } from './cues'
import type { HostServices } from './host-services'
import type { ModelDriverRuntime } from './lifecycle'
import type { ModelId, ModelProfileId } from './model'
import type { EntrypointRequest, EntrypointResolution, HostRegistryClient, ManagerChannel } from './registry'
import type { ContractResult, ModelDriverId } from './shared'

export interface Adapter {
  /** The window this adapter serves. The registry fills a mount's `windowId` from it. */
  readonly windowId: string
  /** The registry client this adapter registers mounts through. Mount ids come from here, not from the adapter. */
  readonly registry: HostRegistryClient

  /**
   * Mint the identity of a model that is about to be imported.
   *
   * Called once per model, before `probe`/`confirmImport`, and again for a restore or a transfer that
   * needs a *fresh* identity. A backup, a restore and a device transfer **preserve** the ids they
   * carry instead (`D18`); only a new identity is minted, which is why the migration path asks for one
   * and keeps the legacy id as provenance.
   */
  mintModelId: () => ModelId
  /** Mint the identity of a model profile, under the same rule as `mintModelId`. */
  mintProfileId: () => ModelProfileId

  /**
   * Ask the manager which module implements one of its entry kinds, for one surface and purpose.
   *
   * The answer is a specifier; importing it is the adapter's job and the loader table's policy. A
   * `null` resolution means the driver ships no such kind. An unknown specifier is
   * `ContractFailureCode.INVALID_ENTRYPOINT` with a readable reason.
   */
  requestEntrypoint: (
    request: EntrypointRequest,
  ) => Promise<ContractResult<EntrypointResolution>>

  /**
   * Load and activate this driver in this window, returning the live runtime.
   *
   * Idempotent per `(window, driver)`: one runtime exists per driver per window, so a second request
   * answers the same instance rather than activating twice.
   */
  importRuntime: (driverId: ModelDriverId) => Promise<ContractResult<ModelDriverRuntime>>

  /**
   * The service container this window provides to one driver.
   *
   * Stable for the window's lifetime, so a panel or a picker mounted later reads the same object the
   * runtime was activated with — a second container would mean a second `HostServices.contract` that
   * could disagree.
   */
  getService: (driverId: ModelDriverId) => Promise<ContractResult<HostServices>>

  /** The window's cue channel. One per window, so every transaction in it shares one bus. */
  getCueChannel: () => Promise<CueChannel>

  /**
   * Open (or reuse) the opaque message channel to this driver's manager.
   *
   * **Authentication is binding, not negotiation.** The channel is created only for a window that
   * asked through this adapter, and main drops any message whose sender is not that window: the
   * registry owns the `webContents` identity, so there is no token to leak and no handshake for the
   * driver to implement. The pair `(window, driver)` is the whole credential.
   */
  openManagerChannel: (driverId: ModelDriverId) => Promise<ContractResult<ManagerChannel>>
}
