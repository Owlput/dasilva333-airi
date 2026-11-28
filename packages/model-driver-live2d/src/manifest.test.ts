import { assertCapabilityCompleteness, CueKind, isContractCompatible, validateManifest } from '@proj-airi/stage-renderer-sdk'
import { describe, expect, it } from 'vitest'

import {
  LIVE2D_CAPABILITIES,
  LIVE2D_DRIVER_ID,
  LIVE2D_MANAGER_SPECIFIER,
  LIVE2D_MANIFEST,
  LIVE2D_MOUNT_SPECIFIER,
  LIVE2D_PROVIDER_SPECIFIER,
} from './manifest'

describe('live2d manifest', () => {
  it('passes the contract validator', () => {
    const result = validateManifest(LIVE2D_MANIFEST)
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
  })

  it('is compatible with the running contract', () => {
    const result = isContractCompatible(LIVE2D_MANIFEST.contractVersion)
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
  })

  it('declares a complete capability record', () => {
    const result = assertCapabilityCompleteness(LIVE2D_CAPABILITIES)
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
  })

  it('uses one stable driver id and names the manager it is loaded from', () => {
    expect(LIVE2D_MANIFEST.id).toBe(LIVE2D_DRIVER_ID)
    expect(LIVE2D_MANIFEST.entry.manager).toBe(LIVE2D_MANAGER_SPECIFIER)
    expect(LIVE2D_MANAGER_SPECIFIER).not.toBe(LIVE2D_PROVIDER_SPECIFIER)
    expect(LIVE2D_PROVIDER_SPECIFIER).not.toBe(LIVE2D_MOUNT_SPECIFIER)
  })

  it('never declares `load`, which every mount must handle', () => {
    expect(LIVE2D_CAPABILITIES.cues).not.toContain(CueKind.LOAD)
    expect(new Set(LIVE2D_CAPABILITIES.cues).size).toBe(LIVE2D_CAPABILITIES.cues.length)
  })

  it('declares the Cubism core and a canvas it measures itself', () => {
    expect(LIVE2D_MANIFEST.requirements.webgl).toBe(2)
    expect(LIVE2D_MANIFEST.requirements.dom).toBe('canvas')
    expect(LIVE2D_MANIFEST.requirements.globalScripts).toContain('live2dcubismcore.min.js')
  })
})
