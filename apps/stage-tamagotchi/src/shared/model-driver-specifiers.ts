/**
 * The module specifiers this build knows, in one place, for both processes.
 *
 * A driver's entry points are named by **strings**: main's table names the manifest and manager specifiers,
 * and the manager names the provider/mount/panels/picker specifiers that the renderer's loader table maps to
 * real modules (§4.7). The two sides must agree, and they cannot import each other's module to find out —
 * main's table has to be static before any driver code runs, and the fixture lives behind a subpath that a
 * production build must not pull in.
 *
 * So the strings live here. Drift is still caught, and caught loudly: the registry refuses a manifest whose
 * `id` or `entry.manager` does not match the table with a readable reason, and the adapter refuses a
 * specifier its loader table does not know as `invalid-entrypoint`.
 *
 * Phase 1 ships the stub driver only. Real drivers arrive one per phase (Phase 3+) and add their specifiers
 * here at the same time as their package, which is the point of a single list. The fixture's specifiers point
 * at the SDK's `./testing` subpath, which is where the stub and its harness live since P1-D27.
 */

/** The fixture's driver id. Matches `STUB_DRIVER_ID` in `@proj-airi/stage-renderer-sdk/testing`. */
export const STUB_DRIVER_ID = 'ai.moeru.airi.test.stub'

export const STUB_MANIFEST_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubManifest'
export const STUB_MANAGER_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubManager'
export const STUB_PROVIDER_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubProvider'
export const STUB_MOUNT_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubMount'
export const STUB_PANEL_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubPanels'
export const STUB_PICKER_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubPicker'
