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
import type { ModelProbeInput, ModelProbeResult } from './provider'
import type {
  ContractResult,
  MaybePromise,
  ModelDriverId,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from './shared'

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
 * of one model, editing or deleting a profile. It does **not** import: when the user wants something
 * the driver can present but AIRI does not hold, it calls the host-supplied `requestImport` callback
 * with the files it has, and the host opens the same import panel any other import uses. AIRI mounts
 * the picker, supplies that callback, and receives `select`.
 */
export interface ModelPickerProps {
  /** The character being served, so the picker can mark its current choice. */
  characterId?: CharacterId
  /** The model the character currently uses, when it has one. */
  currentModelId?: ModelId
  /** The profile the character currently uses, when it has one. */
  currentProfileId?: ModelProfileId
  /**
   * Open the host's import surface with these files, resolving when that surface closes.
   *
   * **Absent means this host has no import surface for this driver.** A picker must not offer "add a model"
   * without it, and it never imports on its own: it hands the files over and the promise is its only signal that
   * the dialog is gone. Syncing what was imported is the driver's own business — re-read its storage, or watch a
   * key it already holds; the host deliberately relays nothing.
   *
   * A callback rather than a prop/emit pair, because this direction of communication is host-to-driver and does
   * not need Vue: the same contract can be implemented by a picker that is not a Vue component, and the picker
   * interface should not grow a member for every host chrome detail.
   */
  requestImport?: (request: ModelImportRequest) => Promise<void>
  /** The same service container the driver receives at activation. */
  services: HostServices
}

/**
 * What a picker reports.
 *
 * `select` carries **imported** ids only. A builtin model — a preset the driver ships — may be
 * listed and may be chosen, but it must be imported first, and the picker does not do that itself:
 * it hands the files to `requestImport`, the host opens its import panel, and the imported pair comes
 * back as a `select`. AIRI has no way to reference a builtin, so emitting one would be a reference it
 * could never resolve again.
 */
export interface ModelPickerEmits {
  select: (selection: ModelSelection) => void
  /** The user closed the picker without choosing. */
  cancel: () => void
}

/**
 * The input a picker hands to the host's import flow.
 *
 * The files are the picker's to obtain — from its own `<input type="file">`, a drop target, or a builtin it can
 * materialize — because a driver's picker is a component in the host window and a `File` only comes from user
 * chrome. What it may not do is write, mint or commit them.
 */
export interface ModelImportRequest {
  /**
   * The input, exactly as the picker has it: a single archive, or a model together with the files it references.
   *
   * One set for the whole request, like `ModelProbeInput.files`: the host does not split it, and neither does AIRI.
   */
  files: File[]
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
 * The driver's import surface: the code a host import panel calls to read one input and to commit what it read.
 *
 * It is the module `ModelDriverEntryKind.IMPORT` addresses, and nothing more special than that: the manager names
 * a specifier, the adapter imports it through its loader table, and the host calls the functions it exports. There
 * is no second kind of entry, no separate transport and no host-side import method — the kind is the only
 * distinction between this and a mount.
 *
 * The split with the host is the one §5.3 draws: the host owns the dialog (the input, merging what several drivers
 * report, ordering by confidence, the confirmation) and the driver owns its format (reading the input, writing the
 * bytes, settling each committed part). Hence a module of functions rather than a component: the driver has no
 * opinion about the chrome, and a driver-rendered dialog could not be merged with another driver's.
 */
export interface ModelImportEntry {
  /**
   * Inspect one input and report the models inside it.
   *
   * Writes nothing: the answer is a description plus the callback that commits (C21). It is the same
   * `ModelProbeResult` a provider returns, because a driver has exactly one answer to "what is in this input" —
   * the provider's `probe` and this entry must agree, and both settle parts under host-minted ids.
   */
  probe: (input: ModelProbeInput) => MaybePromise<ContractResult<ModelProbeResult>>
}

/** What the host passes when it builds an import entry. */
export interface ModelImportEntryOptions {
  /**
   * The window's container for this driver, so a probe reads and a commit writes inside the driver's own namespace.
   *
   * The same container a panel, a picker and the provider receive — the import is not a special case that gets a
   * second one.
   */
  services: HostServices
}

/** What the import entry module exports. */
export interface ModelImportEntryModule {
  createImportEntry: (options: ModelImportEntryOptions) => ModelImportEntry | Promise<ModelImportEntry>
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
