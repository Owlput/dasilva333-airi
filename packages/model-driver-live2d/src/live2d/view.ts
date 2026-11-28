/**
 * One Live2D viewport, owned by one mount.
 *
 * **Per instance, no singleton** (plan D-1): the legacy renderer keeps its model in a store singleton, which makes
 * two mounts of one driver share a model -- the obligation this class exists to keep. Everything a mount needs
 * (application, model, caption, resize observer) lives on the instance and dies with it.
 *
 * The host never touches any of it: the mount owns the canvas inside the box the host gave it, measures that box
 * itself (there is no size prop), and answers the declared queries synchronously.
 */
import type { RendererMountHitArea, RendererMountPoint } from '@proj-airi/stage-renderer-sdk'

import type { Live2DProfileBody } from '../profile'

import { Application } from '@pixi/app'
import { extensions } from '@pixi/extensions'
import { Text } from '@pixi/text'
import { Ticker, TickerPlugin } from '@pixi/ticker'
import { GazeMode, ResetScope } from '@proj-airi/stage-renderer-sdk'
import { Live2DModel } from 'pixi-live2d-display/cubism4'

import { computeFit, normalizeProfileBody } from '../profile'

import './zip-loader'

/** Ticker/extension registration is per window, not per mount: doing it twice warns and adds nothing. */
let tickerRegistered = false

function registerPixiRuntime(): void {
  if (tickerRegistered)
    return
  tickerRegistered = true
  // https://guansss.github.io/pixi-live2d-display/#package-importing
  Live2DModel.registerTicker(Ticker)
  extensions.add(TickerPlugin)
}

export interface Live2DViewCallbacks {
  /** The first real frame was presented; the host uses it to hide loading UI. */
  onFirstFrame?: () => void
  onContextLost?: () => void
  /** A region entered/left under the pointer, edge-triggered (RFC §8.5). */
  onHitAreaChange?: (change: { areaId: string, entered: boolean }) => void
}

const CAPTION_STYLE = {
  fontFamily: 'sans-serif',
  fontSize: 28,
  fill: 0xFFFFFF,
  stroke: 0x000000,
  strokeThickness: 4,
  align: 'center' as const,
  wordWrap: true,
}

export class Live2DView {
  private readonly container: HTMLElement
  private readonly callbacks: Live2DViewCallbacks
  private app?: Application
  private model?: Live2DModel
  private caption?: Text
  private resizeObserver?: ResizeObserver
  private cssWidth = 1
  private cssHeight = 1
  /** The expression this view last applied, so a repeat is a success rather than a refusal. */
  private appliedExpression?: string
  /** The appearance this view is drawing: kept here because a resize has to re-apply it (`computeFit`). */
  private profile: Live2DProfileBody = {}
  private disposed = false
  private readonly resolution = 2

  constructor(container: HTMLElement, callbacks: Live2DViewCallbacks = {}) {
    this.container = container
    this.callbacks = callbacks
  }

  get canvas(): HTMLCanvasElement | undefined {
    return this.app?.view as unknown as HTMLCanvasElement | undefined
  }

  /** Create the PIXI application and canvas, sized from the host's box. */
  start(): void {
    registerPixiRuntime()

    this.measure()
    const app = new Application({
      width: Math.max(1, this.cssWidth * this.resolution),
      height: Math.max(1, this.cssHeight * this.resolution),
      backgroundAlpha: 0,
      // Capture reads the drawing buffer after `render()`, so the buffer must survive the frame.
      preserveDrawingBuffer: true,
      autoDensity: false,
      resolution: 1,
    })
    this.app = app
    app.stage.scale.set(this.resolution)

    const canvas = app.view as unknown as HTMLCanvasElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.setAttribute('data-html2canvas-ignore', 'true')
    this.container.appendChild(canvas)

    // The model updates from this application's ticker rather than its own shared one, so pausing the host's
    // box pauses everything and there is exactly one clock per mount.
    app.ticker.add(() => {
      const delta = app.ticker.deltaMS
      this.model?.update(delta)
      this.layoutCaption()
    })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)

    app.render()
    this.callbacks.onFirstFrame?.()
  }

  /**
   * Load one model from the bytes the provider stored.
   *
   * A previous model is destroyed first: a `LoadCue` on a live mount is a model swap, and the mount survives it
   * (`MountHost` re-arms the load rather than remounting). The view only reaches `model-loaded` after the swap.
   */
  async load(bytes: Uint8Array<ArrayBuffer>, name = 'model.zip'): Promise<void> {
    if (!this.app) {
      this.start()
    }
    if (!this.app || this.disposed)
      throw new Error('The Live2D view is not running')

    if (this.model) {
      this.app.stage.removeChild(this.model)
      this.model.destroy()
      this.model = undefined
    }

    // A `File` (not a blob URL) is what routes the library to its ZipLoader; the zip name is what it keys on.
    const archive = new File([bytes], name.endsWith('.zip') ? name : `${name}.zip`, { type: 'application/zip' })
    const model = await Live2DModel.from([archive], { autoInteract: false, autoUpdate: false })

    // The mount may have been disposed while the model was parsing; destroying here is the only leak-free exit.
    if (this.disposed || !this.app) {
      model.destroy()
      return
    }

    this.model = model
    // A replaced model carries no expression, so the next `EXPRESSION` cue must go through the manager again.
    this.appliedExpression = undefined
    this.app.stage.addChild(model)
    model.anchor.set(0.5, 0.5)
    model.update(0)
    this.fit()

    if (!this.caption) {
      this.caption = new Text('', CAPTION_STYLE)
      this.caption.anchor.set(0.5, 0)
      this.caption.visible = false
      this.app.stage.addChild(this.caption)
    }
    this.layoutCaption()
    this.app.render()
  }

  /**
   * Apply one profile body: the appearance this driver stored for the profile (D-9).
   *
   * Separate from `load` because a model swap and an appearance change are independent events that can arrive in
   * either order, and because a profile is savable with no mount at all. A body that names an expression applies it
   * as the resting face; a body without one leaves whatever the last cue set alone, so a try-on does not erase it.
   */
  applyProfile(body: Live2DProfileBody | undefined): void {
    this.profile = normalizeProfileBody(body)
    if (!this.model || !this.app)
      return

    this.fit()
    const expression = this.profile.expression
    if (expression && expression !== this.appliedExpression) {
      // A resting expression the model does not have is not a failed profile: the model keeps the face it has.
      void this.setExpression(expression).catch((error) => {
        console.error('[live2d] the profile expression could not be applied', error)
      })
    }
    this.app.render()
  }

  setPaused(paused: boolean): void {
    if (!this.app)
      return
    if (paused)
      this.app.ticker.stop()
    else
      this.app.ticker.start()
  }

  setVisible(visible: boolean): void {
    if (this.canvas)
      this.canvas.style.visibility = visible ? 'visible' : 'hidden'
    this.setPaused(!visible)
  }

  /**
   * Play one motion. The key is the driver's own capability key (`group#index`).
   *
   * Resolves `true` when the motion finished. `repeat` is refused rather than ignored: looping lives in the motion
   * policy this driver does not have yet, and accepting the cue while dropping the loop would misreport it.
   */
  async playMotion(key: string, repeat?: number): Promise<boolean> {
    if (!this.model)
      throw new Error('No model is loaded')
    if (repeat !== undefined && repeat !== 1)
      throw new Error('This driver does not support repeating a motion yet')

    const [group, indexText] = key.includes('#') ? [key.slice(0, key.lastIndexOf('#')), key.slice(key.lastIndexOf('#') + 1)] : [key, '0']
    const index = Number.parseInt(indexText, 10)
    if (!group || Number.isNaN(index))
      throw new Error(`\`${key}\` is not a motion key`)
    return this.model.motion(group, index)
  }

  /**
   * Apply one expression by name. Returns `false` when the model has no such expression.
   *
   * `Live2DModel.expression()` resolves `false` both for "that is already the current expression" and for a failed
   * asset load, so this view remembers what it applied instead of reporting a repeat as a refusal.
   */
  async setExpression(key: string): Promise<boolean> {
    if (!this.model)
      return false
    if (key === this.appliedExpression)
      return true
    const manager = this.model.internalModel.motionManager.expressionManager
    if (!manager || manager.getExpressionIndex(key) < 0)
      return false
    if (!await this.model.expression(key))
      return false
    this.appliedExpression = key
    return true
  }

  /** Point the model's gaze. Modes this driver cannot express return `false`. */
  setGaze(mode: GazeMode, point?: RendererMountPoint): boolean {
    if (!this.model)
      return false
    if (mode === GazeMode.NONE) {
      const centre = this.toWorld(this.cssWidth / 2, this.cssHeight / 2)
      this.model.focus(centre.x, centre.y, true)
      return true
    }
    if (mode === GazeMode.TARGET || mode === GazeMode.POINTER) {
      if (!point)
        return false
      const target = this.toWorld(point.x, point.y)
      this.model.focus(target.x, target.y, true)
      return true
    }
    return false
  }

  setCaption(text: string): void {
    if (!this.caption)
      return
    this.caption.text = text
    this.caption.visible = text.length > 0
    this.layoutCaption()
  }

  /** Apply a reset scope. Returns `false` for a scope this driver has no state for. */
  reset(scope: ResetScope): boolean {
    if (!this.model)
      return false
    const internal = this.model.internalModel
    const resetMotion = () => internal.motionManager.stopAllMotions()
    const resetExpression = () => {
      internal.motionManager.expressionManager?.resetExpression()
      this.appliedExpression = undefined
    }

    switch (scope) {
      case ResetScope.MOTION:
        resetMotion()
        return true
      case ResetScope.EXPRESSION:
        resetExpression()
        return true
      case ResetScope.CAPTION:
        this.setCaption('')
        return true
      case ResetScope.ALL:
        resetMotion()
        resetExpression()
        this.setCaption('')
        this.setGaze(GazeMode.NONE)
        return true
      default:
        return false
    }
  }

  stopAll(): void {
    if (!this.model)
      return
    this.model.internalModel.motionManager.stopAllMotions()
    this.setCaption('')
  }

  /** Capture the drawing buffer as bytes; `null` when the renderer or canvas is gone. */
  async capture(): Promise<{ mime: string, data: ArrayBuffer, width: number, height: number } | null> {
    const app = this.app
    const canvas = this.canvas
    if (!app || !canvas)
      return null

    try {
      app.render()
    }
    catch (error) {
      console.error('[live2d] render failed during capture', error)
      return null
    }

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob)
      return null

    return {
      mime: blob.type || 'image/png',
      data: await blob.arrayBuffer(),
      width: canvas.width,
      height: canvas.height,
    }
  }

  /**
   * A small square thumbnail of the current frame, as a data URL (D-8).
   *
   * The driver owns preview generation because AIRI must never render a format; a mount that has already drawn the
   * model is the cheapest place to take it. Deliberately not `capture()`: a full-resolution PNG is a capture (an ack
   * payload), while a row thumbnail has to stay small enough to sit in a list and in the driver's storage. The source
   * box is fitted into a square with its aspect preserved, on a transparent background, encoded as WebP.
   */
  async capturePreview(size = 160): Promise<string | null> {
    const app = this.app
    const canvas = this.canvas
    if (!app || !canvas)
      return null

    try {
      app.render()
    }
    catch (error) {
      console.error('[live2d] render failed during preview capture', error)
      return null
    }

    if (typeof document === 'undefined' || typeof canvas.width !== 'number' || canvas.width === 0)
      return null

    const offscreen = document.createElement('canvas')
    offscreen.width = size
    offscreen.height = size
    const context = offscreen.getContext('2d')
    if (!context)
      return null

    const scale = Math.min(size / canvas.width, size / canvas.height)
    const width = canvas.width * scale
    const height = canvas.height * scale
    context.drawImage(canvas as unknown as CanvasImageSource, (size - width) / 2, (size - height) / 2, width, height)
    return offscreen.toDataURL('image/webp', 0.8)
  }

  /** Does the view draw anything at `point`? Points are in the host's mount-local CSS space. */
  occupiesPoint(point: RendererMountPoint): boolean {
    if (!this.model)
      return false
    // Bounds, not per-pixel alpha: this is the test the library exposes for click-through routing, and an
    // alpha-exact one would need a `readPixels` stall on every pointer move.
    const bounds = this.model.getBounds()
    const world = this.toWorld(point.x, point.y)
    return bounds.contains(world.x, world.y)
  }

  /** Which declared hit area covers `point`, or `null`. */
  hitTest(point: RendererMountPoint): RendererMountHitArea | null {
    if (!this.model)
      return null
    try {
      // `hitTest` takes world space and converts to the model's own canvas space itself.
      const world = this.toWorld(point.x, point.y)
      const [areaId] = this.model.hitTest(world.x, world.y)
      if (!areaId)
        return null
      return { areaId, name: areaId }
    }
    catch {
      return null
    }
  }

  /** Re-measure the host's box. Called by the mount's resize observer and by the host's own layout changes. */
  resize(): void {
    if (!this.app || this.disposed)
      return
    this.measure()
    this.app.renderer.resize(Math.max(1, this.cssWidth * this.resolution), Math.max(1, this.cssHeight * this.resolution))
    this.app.stage.scale.set(this.resolution)
    this.fit()
    this.layoutCaption()
    this.app.render()
  }

  destroy(): void {
    this.disposed = true
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined
    this.caption?.destroy()
    this.caption = undefined
    this.model?.destroy()
    this.model = undefined
    // `true` removes the view; the canvas was appended by this class and must not outlive it.
    this.app?.destroy(true)
    this.app = undefined
  }

  private measure(): void {
    const rect = this.container.getBoundingClientRect()
    this.cssWidth = Math.max(1, Math.round(rect.width))
    this.cssHeight = Math.max(1, Math.round(rect.height))
  }

  /**
   * Host points are CSS; the stage is scaled by `resolution`, so world = CSS × `resolution`.
   *
   * `focus`, `hitTest` and `getBounds` speak world space, while the model's position and the caption are stage-local
   * — which is CSS by construction, because the canvas is drawn at `resolution` and displayed at CSS size.
   */
  private toWorld(x: number, y: number): { x: number, y: number } {
    return { x: x * this.resolution, y: y * this.resolution }
  }

  /** Fit the model inside the box, centred, with a little breathing room. */
  private fit(): void {
    if (!this.model)
      return
    const model = this.model
    model.update(0)
    const bounds = model.getLocalBounds()
    const fit = computeFit({
      box: { width: this.cssWidth, height: this.cssHeight },
      content: {
        width: Math.max(1, bounds.width || model.internalModel.width),
        height: Math.max(1, bounds.height || model.internalModel.height),
      },
      body: this.profile,
    })
    model.scale.set(fit.scale)
    model.position.set(fit.x, fit.y)
    model.alpha = fit.opacity
  }

  private layoutCaption(): void {
    if (!this.caption)
      return
    this.caption.style.wordWrapWidth = Math.max(120, this.cssWidth * 0.8)
    this.caption.position.set(this.cssWidth / 2, 16)
  }
}
