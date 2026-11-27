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
 */
import type { HostServices } from '../contract/host-services'
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

export interface DriverLoaderTable {
  /**
   * Resolve one provider specifier, or `undefined` when this build does not ship it.
   *
   * `undefined` is the adapter's `invalid-entrypoint`: a manager naming a module the build does not contain is a
   * declaration bug, never a fallback to another entry.
   */
  resolveProvider: (specifier: string) => (() => Promise<DriverProviderModule>) | undefined
  /** Every provider specifier this build can run, for the startup check §4.7 asks for. */
  providers: () => string[]
}
