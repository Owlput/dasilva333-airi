/**
 * The loader table: how an entry *specifier* becomes the code an adapter may run.
 *
 * A manager names a specifier and the adapter imports it through a table the build owns. The indirection is
 * the point — one table can be audited, a `specifier → import` map cannot be forged by a manager, and an
 * unknown specifier is a refusal with a readable reason (`invalid-entrypoint`) instead of a dynamic import of
 * something unchecked.
 *
 * **One table, one lookup.** `ModelDriverEntryKind` is the only distinction: `resolve` names a kind and a
 * specifier and answers the loader for that module, whatever the module exports. The table does not branch on
 * the kind, and neither does the adapter; what each kind's module must export is stated by the contract
 * (`DriverProviderModule` below, and `RendererMountComponentModule`, `ModelDriverPanelComponentModule`,
 * `ModelPickerComponentModule`, `ModelImportEntryModule`), and the adapter checks it at the boundary.
 *
 * The table is an interface here and a constant in the app: which specifiers a build ships is host policy, not
 * contract. A test supplies a table that maps its fixture; a driver package adds its subpaths to the app's
 * table when it lands.
 */
import type { ModelDriverPanelDeclaration } from '../contract/components'
import type { HostServices } from '../contract/host-services'
import type { ModelDriverEntryKind } from '../contract/registry'
import type { ModelDriverId } from '../contract/shared'

import { ModelDriverEntryKind as EntryKind } from '../contract/registry'

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

/** One entry module, loaded on demand. Its export shape is the contract's, per kind. */
export type DriverEntryModuleLoader = () => Promise<unknown>

export interface DriverLoaderTable {
  /**
   * Resolve one kind's specifier to the module loader this build ships, or `undefined` when it ships none.
   *
   * `undefined` is the adapter's `invalid-entrypoint`: a manager naming a module the build does not contain is a
   * declaration bug, never a fallback to another entry. The kind is passed through so a table can be keyed by it
   * without any per-kind member.
   */
  resolve: (kind: ModelDriverEntryKind, specifier: string) => DriverEntryModuleLoader | undefined
  /** Every specifier this build can run for one kind, for the startup check §4.7 asks for. */
  specifiers: (kind: ModelDriverEntryKind) => string[]
}

/**
 * A table with no modules of its own beyond the providers it is given.
 *
 * Used by the in-process harness and by a test that only cares about one entry kind. It is deliberately not a
 * default in the adapter: "what does this build ship" stays the embedder's answer (P1-D24).
 */
export function providerOnlyLoaderTable(
  resolveProvider: (specifier: string) => DriverEntryModuleLoader | undefined,
  providers: string[],
): DriverLoaderTable {
  return {
    resolve: (kind, specifier) => (kind === EntryKind.PROVIDER ? resolveProvider(specifier) : undefined),
    specifiers: kind => (kind === EntryKind.PROVIDER ? providers : []),
  }
}
