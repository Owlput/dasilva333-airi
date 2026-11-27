/**
 * A `HostLogger` a renderer can use without owning a logging library.
 *
 * The contract's logger is a sink, not a framework (four levels, one scope prefix, arbitrary values), and an
 * embedder must not need a dependency just to satisfy it. This is the adapter's default: `console` with a
 * `[driver]` prefix so a line still says where it came from. A host with its own logger (`@guiiai/logg` in the
 * desktop app) passes that instead; nothing here reads the output.
 */
import type { HostLogger } from '../contract/host-services'

function format(scope: string, args: unknown[]): unknown[] {
  return args.length === 0 ? [`[${scope}]`] : [`[${scope}]`, ...args]
}

/**
 * A logger that says nothing.
 *
 * The host core's default when an embedder passes none: a test, an in-process host or a service that has not
 * been given the app's logger still gets an object satisfying the contract, without a dependency or output.
 */
export function createSilentLogger(): HostLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

export function createConsoleLogger(): HostLogger {
  return {
    // `console.debug` is the level that matches the contract's `debug`, and the repo's `no-console` rule allows
    // only warn/error/info — a debug logger that logged at info would be the wrong severity, not the wrong call.
    // eslint-disable-next-line no-console
    debug: (scope, ...args) => console.debug(...format(scope, args)),
    info: (scope, ...args) => console.info(...format(scope, args)),
    warn: (scope, ...args) => console.warn(...format(scope, args)),
    error: (scope, ...args) => console.error(...format(scope, args)),
  }
}
