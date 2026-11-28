/**
 * The loader table: how an entry *specifier* becomes the code an adapter may run.
 *
 * A manager names a specifier and the adapter imports it through a table the build owns. The indirection is
 * the point — one table can be audited, a `specifier → import` map cannot be forged by a manager, and an
 * unknown specifier is a refusal with a readable reason (`invalid-entrypoint`) instead of a dynamic import of
 * something unchecked.
 *
 * The table is an interface here and a constant in the app: which specifiers a build ships is host policy, not
 * contract. A test supplies a table that maps its fixture; a driver package adds its six subpaths to the app's
 * table when it lands.
 *
 * **Four kinds, one table (Phase 2).** Phase 1 needed only `provider`, because the only renderer entry a window
 * ever hosted was the provider half. The mount, panels and picker entries arrive with the host surfaces that
 * mount them (§5.2, §5.6), and they belong here for the same reason: this stays the only renderer-side place a
 * driver package is named.
 */
import type { ModelDriverPanelDeclaration, ModelPickerComponentModule } from '../contract/components'
import type { HostServices } from '../contract/host-services'
import type { RendererMountComponentModule } from '../contract/renderer-mount'
import type { ModelDriverId } from '../contract/shared'

export interface DriverEntryStartOptions {
  driverId: ModelDriverId
  services: HostServices
  /** Send one driver-protocol message to the manager on the other side of the channel. */
  send: (message: unknown) => void
}

export interface DriverProviderEntry {
  /** Feed one manager-channel message in. The reply goes out through `send`. */
  onMessage: (message: unknown) => void
  dispose?: () => void
}

/** What a provider module must export. */
export interface DriverProviderModule {
  startProviderEntry: (options: DriverEntryStartOptions) => DriverProviderEntry | Promise<DriverProviderEntry>
}

/**
 * What a panels module resolves to.
 *
 * A function rather than a constant, because a driver may build its declarations from its own state, and because
 * resolving lazily is what keeps a panel's component out of the window's first paint.
 */
export type DriverPanelsModule
  = | { declarations: () => ModelDriverPanelDeclaration[] | Promise<ModelDriverPanelDeclaration[]> }
    | { default: ModelDriverPanelDeclaration[] }

export interface DriverLoaderTable {
  /**
   * Resolve one provider specifier, or `undefined` when this build does not ship it.
   *
   * `undefined` is the adapter's `invalid-entrypoint`: a manager naming a module the build does not contain is a
   * declaration bug, never a fallback to another entry.
   */
  resolveProvider: (specifier: string) => (() => Promise<DriverProviderModule>) | undefined
  /** Resolve one mount component specifier. */
  resolveMount: (specifier: string) => (() => Promise<RendererMountComponentModule>) | undefined
  /** Resolve one panels specifier. */
  resolvePanels: (specifier: string) => (() => Promise<DriverPanelsModule>) | undefined
  /** Resolve one picker component specifier. */
  resolvePicker: (specifier: string) => (() => Promise<ModelPickerComponentModule>) | undefined
  /** Every provider specifier this build can run, for the startup check §4.7 asks for. */
  providers: () => string[]
  /** Every mount specifier this build can run. */
  mounts: () => string[]
  /** Every panels specifier this build can run. */
  panels: () => string[]
  /** Every picker specifier this build can run. */
  pickers: () => string[]
}

/**
 * A table with no renderer entries of its own beyond the providers it is given.
 *
 * Used by the in-process harness and by a test that only cares about one entry kind. It is deliberately not a
 * default in the adapter: "what does this build ship" stays the embedder's answer (P1-D24).
 */
export function providerOnlyLoaderTable(resolveProvider: DriverLoaderTable['resolveProvider'], providers: string[]): DriverLoaderTable {
  return {
    resolveProvider,
    resolveMount: () => undefined,
    resolvePanels: () => undefined,
    resolvePicker: () => undefined,
    providers: () => providers,
    mounts: () => [],
    panels: () => [],
    pickers: () => [],
  }
}
