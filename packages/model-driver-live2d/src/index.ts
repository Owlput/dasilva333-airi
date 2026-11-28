export type { StoredLive2DLegacyEntry } from './legacy'
export {
  LIVE2D_CAPABILITIES,
  LIVE2D_DRIVER_ID,
  LIVE2D_IMPORT_SPECIFIER,
  LIVE2D_MANAGER_SPECIFIER,
  LIVE2D_MANIFEST,
  LIVE2D_MOUNT_SPECIFIER,
  LIVE2D_PANELS_SPECIFIER,
  LIVE2D_PICKER_SPECIFIER,
  LIVE2D_PROVIDER_SPECIFIER,
} from './manifest'
/**
 * `@proj-airi/model-driver-live2d`
 *
 * The Live2D stage driver (RFC 0002). Split into one entry point per subpath, so each process imports only what it
 * can run:
 *
 * | Subpath | Process | Contains |
 * | :--- | :--- | :--- |
 * | `./manifest` | main, renderer | the static declaration; pure data, no Pixi and no Vue |
 * | `./manager` | main | `createManager(handle)`, `resolveEntrypoint`, channel routing; DOM-free |
 * | `./provider` | renderer | `startProviderEntry`, storage, probe/import, prompt publication, cue delivery to mounts |
 * | `./mount` | renderer | the Live2D Vue component (imports Pixi + the Cubism core) |
 * | `./panels` | renderer | the driver's own settings panels (appearance, prompt, capabilities) |
 * | `./picker` | renderer | the driver's own model picker (list and selection of imported models) |
 * | `./import` | renderer | `createImportEntry`, the driver half of the host's model-import panel |
 *
 * This root entry is for code that wants the declaration and the model-row/storage types without pulling in either
 * half's implementation: a panel, a test, or the app's static tables.
 */
export type { Live2DFit, Live2DFitInput, Live2DProfileBody } from './profile'
export type { StoredLive2DPrompt } from './prompt'
export type { Live2DMountBinding } from './session'

export type { StoredLive2DExpression, StoredLive2DModel, StoredLive2DMotion, StoredLive2DProfile } from './storage'
