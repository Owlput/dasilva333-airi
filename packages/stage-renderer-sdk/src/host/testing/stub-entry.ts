/**
 * The stub driver's window half, as a real provider entry (§4.8).
 *
 * The manager half is in main and the window half is here; they share no state, only the manager channel. That
 * separation is the whole point of the fixture — it proves the transport instead of simulating both ends in one
 * object — so this module starts a real `createStubRendererHalf`, activates its runtime against the services the
 * adapter supplies, and answers the manager over `send`.
 *
 * **Stateless on purpose.** The session it creates is handed to `onSession` rather than kept in a module map: in
 * a single process two windows can host the same driver, and a module-level map keyed by driver would let the
 * second window's session overwrite the first's. The application keeps the map where its module instance is per
 * window (`renderer/libs/model-drivers/stub-entry.ts`); the in-process harness keys it by window id.
 */
import type {
  HostServices,
  ModelDriverId,
  RendererMountPurpose,
  RendererMountSurfaceKind,
} from '../../contract'
import type { DriverProviderEntry } from '../loaders'
import type { StubDriverState, StubModel, StubMount } from './stub-driver'

import { createStubDriverState, createStubMount, createStubRendererHalf } from './stub-driver'

/** What one window's stub entry contains, for a surface that wants to drive it (a dev route, a test). */
export interface StubWindowSession {
  driverId: ModelDriverId
  state: StubDriverState
  /** This window's mounts. The window half filters them by the envelope's target. */
  mounts: StubMount[]
  /** The services the runtime was activated with, once activation has run. */
  services: () => HostServices | undefined
  /** Whether the runtime finished activating successfully. */
  activated: () => boolean
  /** Create a mount in this window. The caller attaches the registry-issued id once it has one. */
  openMount: (input: { surface: RendererMountSurfaceKind, purpose: RendererMountPurpose }) => StubMount
}

export interface StubProviderEntryOptions {
  driverId: ModelDriverId
  services: HostServices
  send: (message: unknown) => void
  /** Models this window's half starts with, so a row pull has something to enumerate. */
  models?: StubModel[]
  /** The session this entry created, delivered once it exists. */
  onSession?: (session: StubWindowSession) => void
  /** Publish an empty prompt instead of a text, to prove `('', [])` is a value. */
  publishEmpty?: boolean
}

/**
 * The stub session this module instance's window hosts, by driver.
 *
 * **Only the fixture's Vue components read this**, through `registerStubWindowSession` called by the app's
 * per-window entry. It is deliberately not populated by `startStubProviderEntry`, because the in-process harness
 * runs two "windows" in one module instance and an automatically populated map would let the second overwrite the
 * first (P1-D29). A real window's module instance is per window, which is what makes the map correct there.
 */
const windowSessions = new Map<ModelDriverId, StubWindowSession>()

export function registerStubWindowSession(session: StubWindowSession): () => void {
  windowSessions.set(session.driverId, session)
  return () => {
    if (windowSessions.get(session.driverId) === session)
      windowSessions.delete(session.driverId)
  }
}

/** The session this window's entry created, for a component that has to reach it. */
export function stubWindowSession(driverId: ModelDriverId): StubWindowSession | undefined {
  return windowSessions.get(driverId)
}

/** One driver's window half, ready to answer the manager. */
export function startStubProviderEntry(options: StubProviderEntryOptions): DriverProviderEntry {
  const state = createStubDriverState()
  for (const model of options.models ?? [])
    state.models.set(model.modelId, model)

  const mounts: StubMount[] = []
  const half = createStubRendererHalf({
    state,
    mounts,
    ...(options.publishEmpty !== undefined ? { publishEmpty: options.publishEmpty } : {}),
  })

  let services: HostServices | undefined
  let activated = false

  const session: StubWindowSession = {
    driverId: options.driverId,
    state,
    mounts,
    services: () => services,
    activated: () => activated,
    openMount: ({ surface, purpose }) => {
      const mount = createStubMount({ surface, purpose }, state)
      mounts.push(mount)
      return mount
    },
  }

  services = options.services
  options.onSession?.(session)

  // A prompt-capable driver publishes on activation (D5); the publication goes through the adapter's prompt
  // sink, so a test sees the real store rather than a mock of it.
  void half.runtime.activate(options.services).then((report) => {
    activated = report.ok
    if (!report.ok)
      options.services.log.error(options.driverId, `Stub activation failed: ${report.error.message}`)
  })

  return {
    onMessage: message => half.handleMessage(message, options.send),
  }
}
