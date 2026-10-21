/**
 * Concepts that belong to the model driver as a whole.
 *
 * Neither `renderer-mount.ts` (one viewport) nor `provider.ts` (models) is the right home for
 * "what the driver is" beyond those two: the settings panels it contributes, and the opaque bundle
 * that moves an entire driver to another device.
 */
import type { Component } from 'vue'

import type { ModelDriverHostServices } from './host-services'
import type { ModelId, ModelProfileId } from './model'
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
 * A panel is the plugin's settings UI, not part of mounting a view port. The driver decides how
 * many panels it has and what they are called; the host only lists them.
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
 * The driver owns its capability record *and* the UI for it (labels, usable/favourite toggles,
 * idle selection, ACT mappings, outfit profiles), so the host mounts the driver's own component
 * instead of keeping per-format editors in host code.
 *
 * The same component is reused across surfaces and adapts from the `surface` prop it is handed.
 * Host obligations toward a panel:
 *   - **The host provides the frame** (title, tabs, scrolling, padding); the panel only fills the
 *     body.
 *   - **When the driver is unavailable, the panel is not mounted at all.** The host shows that
 *     first and, when a snapshot exists, appends a read-only list built from its `vocabulary`.
 *     `readOnly` below covers the other case: the driver *is* available but this mount must not
 *     edit.
 */
export interface ModelDriverPanelProps {
  /**
   * The model this panel edits.
   *
   * A panel never writes the snapshot itself: only the mounted instance does
   * (`HostStateTransferPort.writeSnapshot`), so two windows cannot race on `revision`.
   */
  modelId: ModelId
  /**
   * The snapshot/prompt scope the panel edits.
   *
   * A panel and its live mount may sit in different windows, so the panel needs the scope to read
   * the snapshot it is allowed to see and to know which mount a preview belongs to.
   */
  stateScope: string
  /** The mount this panel is paired with, when there is one; absent for a catalog-level panel. */
  mountId?: string
  /** The profile the mount currently shows, when known. */
  currentProfileId?: ModelProfileId
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
   * while it waits.
   */
  readiness: RendererMountReadinessState
  /**
   * Mounted for viewing only.
   *
   * The panel MUST NOT change the renderer's stored state for the model, so nothing it does can
   * reach the snapshot. Transient previews are still allowed: those are cues sent with
   * `persistent: false`, which by definition do not persist.
   */
  readOnly?: boolean
  /** The same service container the driver receives at activation. */
  services: ModelDriverHostServices
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

/**
 * The settings AIRI kept for a driver **before this contract existed**, handed over once so they are
 * not lost when the driver starts keeping its own.
 *
 * This is not a transfer bundle. A bundle is the driver's own format, produced by the driver, and
 * restoring one must not depend on AIRI's old key names. This is the opposite direction: AIRI's legacy
 * data, in AIRI's vocabulary, which only a one-time migration knows how to read.
 *
 * The bag is deliberately untyped. Which keys exist is a fact about the host's history rather than
 * about the driver, so it is named by the host and read by the driver on the single occasion it is
 * offered.
 *
 * **Shape not final.** The two fields below are only the current transition shape; the per-model
 * profile mapping has not been designed yet. A driver MUST treat this object as an input it
 * receives once, not as a storage layout or a stable API.
 */
export interface ModelDriverMigrationInput {
  /**
   * The legacy values, keyed by the host's own names, gathered from the settings namespaces that used
   * to belong to this driver.
   *
   * Opaque: a driver reads the entries it recognises and reports the rest in `unused`. The keys are
   * NOT part of this contract and never will be — they disappear together with the host code that
   * writes them, which is why a driver MUST NOT treat them as its storage layout.
   */
  entries: Record<string, unknown>
  /**
   * The model the user had selected when the bag was written, when the host still knows it.
   *
   * Some legacy values are **window-global** rather than per-model: one parameter override map and one
   * expression-alias table applied to whichever model happened to be on screen. Without this, a driver
   * cannot tell which model those values described, and inventing an attribution would attach them to
   * the wrong one.
   */
  selectedModelId?: ModelId
}

/**
 * What a migration did.
 *
 * A driver absorbs what it recognises and names the rest: the host deletes only the entries the driver
 * did not report as `unused`, so a partial migration never destroys data.
 */
export interface ModelDriverMigrationReport {
  /**
   * Legacy keys the driver did not use, by their `entries` names.
   *
   * The host keeps those keys alive and can tell the user once which settings did not survive, instead
   * of deleting something the driver never read.
   */
  unused?: string[]
  /** Non-fatal problems worth surfacing; everything not named here was restored. */
  warnings?: string[]
}
