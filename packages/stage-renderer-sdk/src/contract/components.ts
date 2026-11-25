/**
 * Concepts that belong to the model driver as a whole.
 *
 * Neither `renderer-mount.ts` (one viewport) nor `provider.ts` (models) is the right home for
 * "what the driver is" beyond those two: the panels it contributes, the picker that chooses among
 * its models, and the opaque bundle that moves an entire driver to another device.
 *
 * Pre-contract data lives in `migration.ts`: it is a per-model handover and a per-model restore
 * payload, not a driver-wide bag, because the offer is made one model at a time (D8).
 */
import type { Component } from 'vue'

import type { HostServices } from './host-services'
import type { CharacterId, ModelId, ModelProfileId } from './model'
import type { ModelDriverId, RendererMountReadinessState, RendererMountSurfaceKind } from './shared'

/** The host chrome a driver panel can be mounted into. */
export enum ModelDriverPanelHostSurface {
  SETTINGS = 'settings',
  POPOVER = 'popover',
  INLINE = 'inline',
}

/**
 * A panel the driver contributes to the host's renderer settings surfaces.
 *
 * A panel is the driver's own settings UI: its capability record *and* the UI for it (labels,
 * usable/favourite toggles, idle selection, ACT mappings, outfit profiles, calibration), which is
 * why the host mounts the driver's component instead of keeping per-format editors of its own.
 *
 * A driver's panels entry — resolved through `ModelDriverManager.resolveEntrypoint` with
 * `ModelDriverEntryKind.PANELS` — exports these declarations; each one carries the lazy factory
 * for its own component. The driver decides how many panels it has and what they are called; the
 * host only lists them, in order.
 */
export interface ModelDriverPanelDeclaration {
  /** Stable within the driver; the host uses it to remember the active tab. */
  id: string
  /**
   * Tab title's i18n key or a raw name. Host will attempt to resolve it with i18n service
   * and fallback to raw value when it cannot be resolved.
   */
  label: string
  /**
   * Surfaces this panel is worth mounting in; absent means all.
   *
   * Some panels only make sense somewhere — a physics-tuning panel has nothing to do in the
   * rehearsal room. The host SHOULD either:
   * - render a tab but disabled, with tooltip stating the panel is not available,
   * - OR, render an empty state explaining where the panel is available.
   */
  surfaces?: RendererMountSurfaceKind[]
  /**
   * Host chrome this panel can be mounted into; absent means `settings` only.
   *
   * `popover` is what the control strip uses: the strip supplies an anchor and a dismissable
   * shell, and the driver supplies the whole body. A driver that omits it is not offered there;
   * the host never falls back to a built-in picker.
   */
  hostSurfaces?: ModelDriverPanelHostSurface[]
  /**
   * Lazy component factory of the panel itself.
   *
   * Resolves to the component the host mounts with `ModelDriverPanelProps`, so what a panel
   * receives is checked at the boundary instead of being described only in prose.
   */
  component: () => Promise<ModelDriverPanelComponentModule>
}

/** What a panel's lazy factory resolves to; `default` is what the host mounts. */
export interface ModelDriverPanelComponentModule {
  default: ModelDriverPanelComponent
}

/** A driver-provided panel component: takes `ModelDriverPanelProps` and nothing else from the host. */
export type ModelDriverPanelComponent = Component<ModelDriverPanelProps>

/**
 * The panel contract: the driver-provided UI for its own capabilities and settings.
 *
 * Host obligations toward a panel:
 *   - **The host provides the frame** (title, tabs, scrolling, padding); the panel only fills the
 *     body.
 *   - **When the driver is unavailable, the panel is not mounted at all.** The host shows the
 *     fallback and, when it still has a cached model row, a read-only summary of it.
 *     `readOnly` below covers the other case: the driver *is* available but this mount must not
 *     edit.
 *   - **A panel never writes AIRI state.** It edits the driver's own storage (which a live mount
 *     observes through `HostStorageInterface.watch`) or sends cues; there is no host-side snapshot
 *     for it to publish, and no global stage selection for it to change.
 *
 * The panel is also where a **prompt fault** is surfaced: a prompt-capable driver that has published
 * nothing for the model in front of it shows that state here, because this is the surface that can
 * fix it (D5, D-17).
 */
export interface ModelDriverPanelProps {
  /** The model this panel edits. */
  modelId: ModelId
  /** The profile the mount currently shows, when known. */
  profileId?: ModelProfileId
  /**
   * The mount this panel is paired with, when there is one; absent for a catalog-level panel.
   *
   * A panel and its live mount usually sit in different windows, so this is the only way the panel
   * can address the viewport it is looking at — as a mount query or command (`ModelDriverManager.
   * queryMount`/`commandMount`), and to know which preview belongs to it.
   */
  mountId?: string
  /** Which surface the panel is rendered in, so it can adapt its own layout. */
  surface: RendererMountSurfaceKind
  /**
   * Which host chrome the panel is rendered into.
   *
   * A driver that contributes a control-strip picker gets `popover` and owns the whole body; the
   * host only supplies the anchor and shell. This is deliberately separate from `surface`, which
   * describes the stage context, not the settings chrome.
   */
  hostSurface: ModelDriverPanelHostSurface
  /**
   * Readiness of the mount this panel is attached to.
   *
   * The panel renders its own loading state from this, because capabilities can be
   * undiscoverable until the model has loaded and only the panel knows what it is able to show
   * while it waits. `UNMOUNTED` is a legitimate value: a panel open with no mount can still read
   * capabilities and vocabulary from the driver.
   */
  readiness: RendererMountReadinessState
  /**
   * Mounted for viewing only.
   *
   * The panel MUST NOT change the renderer's stored state for the model. Transient previews are
   * still allowed: those are cues sent with `persistent: false`, which by definition do not
   * persist.
   */
  readOnly?: boolean
  /** The same service container the driver receives at activation. */
  services: HostServices
}

/**
 * One model a user picked, in the only form AIRI accepts.
 *
 * Both ids are Adapter-minted, so a selection is always a reference AIRI already holds — which is
 * what makes "the picker returned a builtin key" inexpressible rather than merely forbidden.
 */
export interface ModelSelection {
  modelId: ModelId
  profileId: ModelProfileId
}

/**
 * The props of a driver-provided model picker.
 *
 * **Choosing a model is not a panel.** Settings panels edit one model the user already has;
 * a picker answers "which model — or which profile of which model — should this character use",
 * including the models only this driver can see. Keeping them apart is what lets the host offer
 * "change model" from places a settings tab cannot reach (a card editor, a fallback view, the
 * control strip) without duplicating per-format UI.
 *
 * A picker owns everything about the choice: listing the driver's models, listing profile variants
 * of one model, importing a file or a builtin, editing or deleting a profile. AIRI only mounts it
 * and receives a `select` emit.
 */
export interface ModelPickerProps {
  /** The character being served, so the picker can mark its current choice. */
  characterId?: CharacterId
  /** The model the character currently uses, when it has one. */
  currentModelId?: ModelId
  /** The profile the character currently uses, when it has one. */
  currentProfileId?: ModelProfileId
  /** The same service container the driver receives at activation. */
  services: HostServices
}

/**
 * What a picker reports.
 *
 * `select` carries **imported** ids only. A builtin model — a preset the driver ships — may be
 * listed and may be chosen, but the picker has to import it first (`probe` → `confirmImport`, with
 * the Adapter minting `modelId`/`profileId`) and then emit the imported pair. AIRI has no way to
 * reference a builtin, so emitting one would be a reference it could never resolve again.
 */
export interface ModelPickerEmits {
  select: (selection: ModelSelection) => void
  /** The user closed the picker without choosing. */
  cancel: () => void
}

/**
 * A driver-provided picker component.
 *
 * Like a mount component, Vue only observes `emits` at runtime through the component's own
 * `defineEmits`, which is why they are named in `ModelPickerEmits` rather than restated here.
 */
export type ModelPickerComponent = Component<ModelPickerProps>

/** What the picker entry resolves to; `default` is what the host mounts. */
export interface ModelPickerComponentModule {
  default: ModelPickerComponent
}

/**
 * A driver packaged for off-device storage.
 *
 * This is the unit AIRI moves when it moves a driver, the counterpart of `ModelTransferBundle`,
 * which moves a single model.
 *
 * Opaque by construction: **there is no field describing what is inside.** A description would be a
 * storage detail AIRI must not learn, and it would go stale the moment the renderer changes.
 * Layout, versioning and any migration live inside the payload, where only the owning driver can
 * read them.
 */
export interface ModelDriverTransferBundle {
  /** Which driver produced it; the host routes a bundle by this. */
  modelDriverId: ModelDriverId
  /** Opaque payload: settings, catalogue, per-model state, profiles, blobs. */
  payload: Blob
}

/**
 * What an import did, for the host to surface.
 *
 * An import succeeds with warnings rather than failing wholesale: a driver restores what it can and
 * reports the rest, because a partly restored driver is more useful to the user than a failed one.
 * A driver that could restore nothing reports a failure through the result envelope instead.
 */
export interface ModelDriverImportReport {
  /** Parts the driver could not restore. Non-fatal; everything else was restored. */
  warnings?: string[]
}
