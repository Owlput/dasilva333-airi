/**
 * The Live2D driver's static declaration (RFC 0002 §6.1).
 *
 * **This module must stay pure data and DOM-free.** Main reads it before any driver code runs, so it may not
 * import Pixi, Vue, the provider half or the mount — the registry refuses a declaration whose `entry.manager`
 * does not match its own table, and a declaration that pulled in a renderer bundle would defeat the whole
 * "declare before you run" split (plan §4.2 step 1, D2).
 */
import type { ModelDriverCapabilities, ModelDriverManifest } from '@proj-airi/stage-renderer-sdk'

import {
  CapabilityDiscoveryMode,
  CueKind,
  MODEL_DRIVER_CONTRACT_VERSION,
  ModelDriverDomRequirement,
  RendererMountInteractionMode,
} from '@proj-airi/stage-renderer-sdk'

/** Stable id. The app's static table and this declaration must agree or the registry refuses the driver. */
export const LIVE2D_DRIVER_ID = 'ai.moeru.airi.live2d'

/**
 * Entry specifiers.
 *
 * `manager` is the only specifier the declaration names; the other five are returned by `resolveEntrypoint` and
 * must match the renderer's loader table exactly (plan §4.7).
 */
export const LIVE2D_MANAGER_SPECIFIER = '@proj-airi/model-driver-live2d/manager'
export const LIVE2D_PROVIDER_SPECIFIER = '@proj-airi/model-driver-live2d/provider'
export const LIVE2D_MOUNT_SPECIFIER = '@proj-airi/model-driver-live2d/mount'
export const LIVE2D_PANELS_SPECIFIER = '@proj-airi/model-driver-live2d/panels'
export const LIVE2D_PICKER_SPECIFIER = '@proj-airi/model-driver-live2d/picker'
export const LIVE2D_IMPORT_SPECIFIER = '@proj-airi/model-driver-live2d/import'

/**
 * What this driver claims it can do **before it runs**.
 *
 * Still narrower than the format can eventually support — no transfer, no capability discovery beyond its stored
 * catalogue, no interaction mode — and every claim here has an implementation behind it: `previewModel` because a
 * mount writes a thumbnail once it rendered the model, `prompt` because `./prompt` publishes per model and profile,
 * `panels` because `./panels` declares three, profiles because `./profile` applies a body to the live view, and
 * `migration` because `./legacy` retains a legacy entry and hands it back for a revert (`restoreLegacy`).
 * `rendererCapabilities()` repeats this record under the resources actually available in the window.
 */
export const LIVE2D_CAPABILITIES: ModelDriverCapabilities = {
  probe: true,
  // The mount encodes a small thumbnail from the frame it rendered (`capturePreview`, D-8); the row carries it as
  // `ModelSummary.preview`, so the driver's own picker and a catalogue row have a real image instead of a stand-in.
  previewModel: true,
  capabilityDiscovery: CapabilityDiscoveryMode.STATIC,
  profiles: true,
  prompt: true,
  modelTransfer: false,
  driverTransfer: false,
  panels: true,
  deactivate: true,
  purge: true,
  migration: true,
  // `act` is declared because the driver projects the tokens it publishes (P3-D13, `./act`): an emotion token becomes
  // an expression, a motion token a motion, and anything else is refused with `unknown-key`.
  cues: [
    CueKind.ACT,
    CueKind.EXPRESSION,
    CueKind.MOTION,
    CueKind.PROFILE,
    CueKind.GAZE,
    CueKind.CAPTION,
    CueKind.RESET,
    CueKind.CAPTURE,
  ],
  // Tactile/pointer interaction is not consumed yet; `pointer` is still wired into the mount for hit-area
  // edges, but no interaction *mode* is offered to the host.
  interactionModes: [RendererMountInteractionMode.NONE],
  occupiesPoint: true,
  hitTest: true,
  stopAll: true,
  dispose: true,
}

export const LIVE2D_MANIFEST: ModelDriverManifest = {
  id: LIVE2D_DRIVER_ID,
  name: 'Live2D',
  driverVersion: '0.1.0',
  contractVersion: MODEL_DRIVER_CONTRACT_VERSION,
  capabilities: LIVE2D_CAPABILITIES,
  requirements: {
    webgl: 2,
    // The Cubism core is a plain script the host page installs; the mount cannot import it as a module.
    globalScripts: ['live2dcubismcore.min.js'],
    dom: ModelDriverDomRequirement.CANVAS,
    storageHintBytes: 64 * 1024 * 1024,
  },
  entry: { manager: LIVE2D_MANAGER_SPECIFIER },
}
