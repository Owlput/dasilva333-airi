/**
 * `HostServices` for one driver in one window.
 *
 * The contract hands a driver a service container at activation (`HostServices`, RFC §10), and every member of
 * it is owned by the host — a driver never reaches the app directly. This is the adapter's implementation of
 * that container: the members that exist and that a mount or a manager can actually use, and nothing that only
 * a particular application could supply.
 *
 * What is deliberately inert, and why:
 *
 *   - `pointer` — the pointer conversion lives with a renderer stage's overlays, which is host UI rather than
 *     contract; a synthetic stream before there is a box to convert against would move a mount's hit testing
 *     into the wrong coordinate space;
 *   - `theme` — the accent hue and the dark flag come from an application's settings store, which this package
 *     does not have. A driver that tints by theme reads zeros, which is the documented "missing optional
 *     service is a reduction in capability" case rather than a crash.
 *
 * A host with real values for either passes its own container instead of this one; the defaults are honest
 * about being defaults, and nothing pretends otherwise.
 */
import type { CueChannel } from '../contract/cues'
import type {
  HostI18nService,
  HostLogger,
  HostPromptService,
  HostServices,
  HostStorageInterface,
  HostThemeService,
  HostUiService,
  HostWindowKind,
  RendererPointerService,
} from '../contract/host-services'
import type { ModelDriverContractVersion, ModelDriverId } from '../contract/shared'

import { MODEL_DRIVER_CONTRACT_VERSION } from '../contract/shared'

export interface DriverWindowServicesOptions {
  driverId: ModelDriverId
  cues: CueChannel
  storage: HostStorageInterface
  prompt: HostPromptService
  logger: HostLogger
  windowKind: HostWindowKind
  /** Overrides the contract revision, for a test that wants to prove a mismatched driver is refused. */
  contract?: ModelDriverContractVersion
}

export function createDriverWindowServices(options: DriverWindowServicesOptions): HostServices {
  const pointer: RendererPointerService = {
    // A subscription naming a mount is accepted and never called: the adapter has no pointer route.
    subscribe: () => () => {},
  }

  const theme: HostThemeService = {
    accentHue: 0,
    isDark: false,
    onChange: () => () => {},
  }

  const ui: HostUiService = {
    toast: (level, message) => {
      options.logger.info(options.driverId, `[${level}] ${message}`)
    },
  }

  const i18n: HostI18nService = {
    // A driver's own translation bundle is the driver package's work; until it ships, the key is the answer,
    // which is visibly untranslated instead of silently wrong.
    t: key => key,
    locale: typeof navigator === 'undefined' ? 'en' : navigator.language,
  }

  return {
    modelDriverId: options.driverId,
    contract: options.contract ?? MODEL_DRIVER_CONTRACT_VERSION,
    log: options.logger,
    storage: options.storage,
    prompt: options.prompt,
    cues: options.cues,
    pointer,
    theme,
    ui,
    i18n,
    runtime: {
      windowKind: options.windowKind,
      debug: {},
    },
  }
}
