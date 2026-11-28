import type { CueChannel } from '../contract/cues'
/**
 * The container a host hands a driver (RFC §10), and the two loggers an embedder can have for free.
 *
 * Two kinds of assertion here, and the second is the one coverage was missing. The first is identity: the container
 * carries *the host's own* objects — logger, storage, prompt channel, cue bus — rather than copies, because a
 * driver that wrote through a copy would write somewhere nobody reads.
 *
 * The second is the deliberate inertness documented at the top of `services.ts`: a host that supplies no pointer and
 * no theme still has to hand a driver a working container, and the file's own comment promises that a missing
 * optional service is "a reduction in capability rather than a crash". Nothing executed those defaults before, so
 * these cases call them. Every collaborator is a mock, because the point is what the container does with one, not
 * what a real logger would print.
 */
import type { HostLogger, HostPromptService, HostStorageInterface, RendererPointerService } from '../contract/host-services'
import type { DriverWindowServicesOptions } from './services'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { HostToastLevel, HostWindowKind } from '../contract/host-services'
import { MODEL_DRIVER_CONTRACT_VERSION } from '../contract/shared'
import { createConsoleLogger, createSilentLogger } from './logging'
import { createDriverWindowServices } from './services'

const DRIVER = 'ai.moeru.airi.test.services'

function createServices(overrides: Partial<DriverWindowServicesOptions> = {}) {
  const logger: HostLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const cues = { send: vi.fn(), withdraw: vi.fn() } as unknown as CueChannel
  const storage = { get: vi.fn(), set: vi.fn(), remove: vi.fn(), keys: vi.fn(), watch: vi.fn() } as unknown as HostStorageInterface
  const prompt = { publish: vi.fn(), onResolution: vi.fn() } as unknown as HostPromptService

  const services = createDriverWindowServices({
    driverId: DRIVER,
    cues,
    storage,
    prompt,
    logger,
    windowKind: HostWindowKind.ACTING,
    ...overrides,
  })

  return { services, logger, cues, storage, prompt }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('driver window services', () => {
  it('carries the host\'s own members rather than copies of them', () => {
    const { services, logger, cues, storage, prompt } = createServices()

    expect(services.modelDriverId).toBe(DRIVER)
    expect(services.contract).toEqual(MODEL_DRIVER_CONTRACT_VERSION)
    expect(services.log).toBe(logger)
    expect(services.storage).toBe(storage)
    expect(services.prompt).toBe(prompt)
    expect(services.cues).toBe(cues)
    expect(services.runtime.windowKind).toBe(HostWindowKind.ACTING)
  })

  it('lets a host build the container for a revision it validated a manifest against', () => {
    const { services } = createServices({ contract: { major: 1, minor: 4 } })

    expect(services.contract).toEqual({ major: 1, minor: 4 })
  })

  it('answers a pointer subscription with an unsubscribe and delivers nothing', () => {
    const { services } = createServices()
    const handler = vi.fn()

    // A host with no hub has no box to convert against, so the honest answer is a stream that never produces a
    // reading — not an invented coordinate, and not a throw.
    const stop = services.pointer.subscribe('mount_1', handler)

    expect(typeof stop).toBe('function')
    expect(() => stop()).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes a window\'s real pointer hub through when the host has one', () => {
    const subscribe = vi.fn(() => () => {})
    const pointer = { subscribe } as unknown as RendererPointerService
    const { services } = createServices({ pointer })
    const handler = vi.fn()

    services.pointer.subscribe('mount_1', handler)

    expect(services.pointer).toBe(pointer)
    expect(subscribe).toHaveBeenCalledWith('mount_1', handler)
  })

  it('defaults the theme to no accent and a light surface, with an unsubscribe', () => {
    const { services } = createServices()

    // Documented as reading zeros rather than crashing: a driver that tints by the accent hue must be able to.
    expect(services.theme.accentHue).toBe(0)
    expect(services.theme.isDark).toBe(false)
    expect(typeof services.theme.onChange(() => {})).toBe('function')
  })

  it('turns a toast into a scoped log line through the host\'s logger', () => {
    const { services, logger } = createServices()

    services.ui.toast(HostToastLevel.WARNING, 'model missing')

    expect(logger.info).toHaveBeenCalledWith(DRIVER, '[warning] model missing')
  })

  it('answers a translation key with the key, and reports a locale', () => {
    const { services } = createServices()

    // A driver's own bundle is the driver package's work: until then the key is visibly untranslated instead of
    // silently wrong.
    expect(services.i18n.t('settings.title')).toBe('settings.title')
    expect(services.i18n.t('settings.title', { count: 2 })).toBe('settings.title')
    expect(typeof services.i18n.locale).toBe('string')
    expect(services.i18n.locale.length).toBeGreaterThan(0)
  })
})

describe('the loggers a host can use without a logging library', () => {
  it('says nothing at all when it is the silent one', () => {
    const spies = [
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ]
    const logger = createSilentLogger()

    logger.debug('model-drivers', 'a')
    logger.info('model-drivers', 'b')
    logger.warn('model-drivers', 'c')
    logger.error('model-drivers', 'd')

    for (const spy of spies)
      expect(spy).not.toHaveBeenCalled()
  })

  it('prefixes every level of the console logger with the scope', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createConsoleLogger()

    logger.debug('model-drivers', 'debug value')
    logger.info('model-drivers', { detail: true })
    logger.warn('model-drivers', 'warning value')
    logger.error('model-drivers', 'error value')

    // `console.debug` is the level that matches the contract's `debug`: the severity is not interchangeable.
    expect(debug).toHaveBeenCalledWith('[model-drivers]', 'debug value')
    expect(info).toHaveBeenCalledWith('[model-drivers]', { detail: true })
    expect(warn).toHaveBeenCalledWith('[model-drivers]', 'warning value')
    expect(error).toHaveBeenCalledWith('[model-drivers]', 'error value')
  })

  it('still names the scope when a line has no arguments', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    createConsoleLogger().info('model-drivers')

    expect(info).toHaveBeenCalledWith('[model-drivers]')
  })
})
