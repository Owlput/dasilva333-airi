import { describe, expect, it } from 'vitest'

/**
 * The two barrels: the package root (`.`) and the host subpath (`./host`).
 *
 * Every other suite imports deep paths, which is right — a test should name what it exercises — but it means a
 * broken or drifted barrel would ship silently. The app imports `.` for the adapter and the contract; the Electron
 * host imports `./host` for the host core. Those two specifiers are the package's actual public surface, so they get
 * one smoke test each: the entry points a consumer depends on are present and are the same objects on both routes.
 */
import * as hostApi from './host/index'
import * as rootApi from './index'

describe('package root barrel', () => {
  it('exports the contract vocabulary a host or a driver reads at a boundary', () => {
    expect(rootApi.MODEL_DRIVER_CONTRACT_VERSION).toEqual({ major: 0, minor: 1 })
    expect(Object.keys(rootApi.READINESS_TRANSITIONS)).toContain('unmounted')
    expect(rootApi.CueKind.LOAD).toBe('load')
    expect(typeof rootApi.ContractFailureCode.CONTRACT_VERSION_MISMATCH).toBe('string')
  })

  it('exports the renderer half an application hands a window', () => {
    expect(typeof rootApi.createModelDriverAdapter).toBe('function')
    expect(typeof rootApi.createDriverStorage).toBe('function')
    expect(typeof rootApi.createDriverWindowServices).toBe('function')
    expect(typeof rootApi.providerOnlyLoaderTable).toBe('function')
    expect(typeof rootApi.createConsoleLogger).toBe('function')
    expect(typeof rootApi.isContractCompatible).toBe('function')
    expect(typeof rootApi.validateCueEnvelope).toBe('function')
  })
})

describe('host subpath barrel', () => {
  it('exports the host core an embedder\'s process instantiates', () => {
    expect(typeof hostApi.createHostCore).toBe('function')
    expect(typeof hostApi.createCueBroker).toBe('function')
    expect(typeof hostApi.createMountRegistry).toBe('function')
    expect(typeof hostApi.createDriverRegistry).toBe('function')
    expect(typeof hostApi.createPromptStore).toBe('function')
    expect(typeof hostApi.createIdMinter).toBe('function')
    expect(typeof hostApi.createModelDriverHostService).toBe('function')
    expect(typeof hostApi.createSpeechFrameBus).toBe('function')
    expect(typeof hostApi.createPointerHub).toBe('function')
    expect(typeof hostApi.createMemoryStoragePort).toBe('function')
    expect(hostApi.HOST_STORAGE_KEYS.root).toBe('model-drivers')
  })

  it('is the same implementation the root barrel exports, not a second copy', () => {
    // The two modules reachable from both specifiers (`loaders`, `logging`) must be one module, not two. If they
    // ever diverged — a duplicated module in a bundle, a stale re-export — an adapter built through one route would
    // not see what the other route configured, which is the kind of bug an `instanceof`-free codebase makes hard to
    // spot. (`host/storage.ts` is deliberately root-only: an embedder's host side never composes a driver namespace,
    // the adapter does.)
    expect(hostApi.createConsoleLogger).toBe(rootApi.createConsoleLogger)
    expect(hostApi.providerOnlyLoaderTable).toBe(rootApi.providerOnlyLoaderTable)
  })
})
