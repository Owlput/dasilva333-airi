/**
 * The `IMPORT` entry: the driver half of the host's model-import panel.
 *
 * What is asserted here is the boundary, not Zip parsing (the probe itself is exercised through the provider's
 * suite): that the module exports the factory the manager's specifier resolves to, that a probe of an input the
 * driver cannot read comes back as a finding rather than a throw, and that the probe still hands back the commit
 * callback the host needs to settle the dialog — with nothing minted and nothing written.
 */
import type { HostServices } from '@proj-airi/stage-renderer-sdk'

import { ContractFailureCode } from '@proj-airi/stage-renderer-sdk'
import { describe, expect, it } from 'vitest'

import { createImportEntry } from './import'

// The non-archive path below never touches storage, which is the point: `probe` writes nothing.
const services = {} as HostServices

describe('live2d import entry', () => {
  it('exports the factory that the IMPORT kind resolves to', () => {
    expect(typeof createImportEntry).toBe('function')
    const entry = createImportEntry({ services })
    expect(typeof entry.probe).toBe('function')
  })

  it('reports an input it cannot read as a blocking finding, not as a failure', async () => {
    const entry = createImportEntry({ services })
    const probed = await entry.probe({ files: [new File(['not a live2d archive'], 'model.txt')] })

    expect(probed.ok).toBe(true)
    if (!probed.ok)
      return
    expect(probed.value.confidence).toBe(0)
    expect(probed.value.parts).toEqual([])
    expect(probed.value.blockingFindings?.length).toBeGreaterThan(0)
  })

  it('still answers with a commit callback, which refuses the same input', async () => {
    const entry = createImportEntry({ services })
    const probed = await entry.probe({ files: [new File(['not a live2d archive'], 'model.txt')] })
    if (!probed.ok)
      throw new Error('the probe should answer a readable result')

    const committed = await probed.value.confirmImport({ selections: [] })
    expect(committed.ok).toBe(false)
    if (!committed.ok)
      expect(committed.error.code).toBe(ContractFailureCode.UNSUPPORTED_INPUT)
  })
})
