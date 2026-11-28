/**
 * Per-window Live2D session.
 *
 * The provider entry (the window half the host starts) activates with the window's `HostServices`; the mount
 * components and any driver UI in the same window read this module to find those services and to register the
 * mounts the manager's `deliver` call must reach. That bridge is deliberate and narrow: the contract gives a
 * mount props and a cue sink, and gives the *runtime* the services, so the two halves meet here rather than
 * through a second prop the contract does not have.
 *
 * One module instance exists per renderer window, which is exactly the scope of a session. Two windows in one
 * process do not share it (Electron gives each window its own bundle); a Node test that needs two sessions must
 * create them explicitly, never rely on a module map (P1-D29).
 */
import type {
  CueSink,
  HostServices,
  RendererMountDisposeStrategy,
  RendererMountHitArea,
  RendererMountPoint,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '@proj-airi/stage-renderer-sdk'

export interface Live2DMountBinding {
  mountId: string
  surface: RendererMountSurfaceKind
  purpose: RendererMountPurpose
  /** What the host's manager call forwards a cue envelope to. */
  sink: CueSink
  /** The mount's own claim, used by `queryMount`. */
  readiness: () => RendererMountReadinessState
  occupiesPoint: (point: RendererMountPoint) => boolean
  hitTest: (point: RendererMountPoint) => RendererMountHitArea | null
  stopAll: () => void
  dispose: (strategy: RendererMountDisposeStrategy) => void
}

class Live2DWindowSession {
  private services: HostServices | undefined
  private send: ((message: unknown) => void) | undefined
  private readonly mounts = new Map<string, Live2DMountBinding>()

  /** Called once by the provider entry, before its runtime activates. */
  attach(options: { services: HostServices, send?: (message: unknown) => void }): void {
    this.services = options.services
    // `activate` may re-attach without a send function; that must not drop the channel the entry attached with.
    if (options.send)
      this.send = options.send
  }

  /** Called on `deactivate`; mounts must already be unmounted by then. */
  detach(): void {
    this.services = undefined
    this.send = undefined
    this.mounts.clear()
  }

  /** The services this window activated the driver with, if any. */
  hostServices(): HostServices | undefined {
    return this.services
  }

  registerMount(binding: Live2DMountBinding): void {
    this.mounts.set(binding.mountId, binding)
  }

  unregisterMount(mountId: string): void {
    this.mounts.delete(mountId)
  }

  /** Every mount in this window matching the address. An absent member is "any", never a wildcard row. */
  mountsFor(surface?: RendererMountSurfaceKind, purpose?: RendererMountPurpose): Live2DMountBinding[] {
    return [...this.mounts.values()].filter((mount) => {
      if (surface !== undefined && mount.surface !== surface)
        return false
      if (purpose !== undefined && mount.purpose !== purpose)
        return false
      return true
    })
  }

  allMounts(): Live2DMountBinding[] {
    return [...this.mounts.values()]
  }

  /**
   * "Read the authority again", never the rows themselves.
   *
   * A model import/removal happens in the window that owns storage, so that window is the one that says the list
   * changed; the manager forwards it to the registry, which pulls (plan §4.3, P1-D20).
   */
  notifyModelsChanged(): void {
    this.send?.({ type: 'notify', method: 'models-changed' })
  }
}

export const live2dSession = new Live2DWindowSession()
