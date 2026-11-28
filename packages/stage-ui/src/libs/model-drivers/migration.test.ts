/**
 * The migration service: the gate, the queue order, and every failure pattern §5.9 names (§9.3).
 *
 * These cases are written against ports, which is the point of the service's shape: the run is testable without a
 * window, a driver, an IndexedDB or a character card, and the fake driver here is exactly as capable of refusing
 * as the real one.
 */
import type { LegacyModelRow, MigrationPorts } from './migration'

import { describe, expect, it } from 'vitest'

import {
  assessMigrationStorage,
  formatBytes,
  orderMigrationQueue,
  runDriverMigration,
} from './migration'

function row(overrides: Partial<LegacyModelRow> = {}): LegacyModelRow {
  return {
    legacyModelId: 'legacy-a',
    name: 'Airi',
    characterBound: true,
    legacyByteSize: 100,
    ...overrides,
  }
}

interface PortState {
  rows: LegacyModelRow[]
  retain?: false
  refuseMigrate?: boolean
  failImport?: boolean
  driverDone?: boolean
  imported?: Map<string, { modelId: string, profileId: string }>
}

function createPorts(overrides: Partial<MigrationPorts> = {}, state: Partial<PortState> = {}) {
  const calls = {
    migrate: 0,
    import: 0,
    commit: 0,
    deleted: [] as string[],
    driverMarker: 0,
  }

  const holder: PortState = {
    rows: state.rows ?? [row()],
    imported: state.imported ?? new Map(),
    ...state,
  }

  const ports: MigrationPorts = {
    listLegacyModels: async () => holder.rows,
    findImportedModel: async legacyModelId => holder.imported?.get(legacyModelId),
    mintModelId: () => `model_${calls.migrate + 1}`,
    mintProfileId: () => 'profile_1',
    buildHandover: async ({ modelId, row: item }) => ({
      modelId,
      legacyModelId: item.legacyModelId,
      meta: { name: item.name },
      settings: { values: {} },
      files: [{ name: 'model.bin', bytes: new Uint8Array([1]) }],
    }),
    migrate: async (entry) => {
      calls.migrate += 1
      if (holder.retain === false)
        return { ok: true, value: { retained: false } }
      if (holder.refuseMigrate)
        return { ok: false, error: { code: 'invalid-package', message: 'refused' } }
      holder.imported?.set(entry.legacyModelId, { modelId: entry.modelId, profileId: 'profile_1' })
      return { ok: true, value: { retained: true } }
    },
    importModel: async () => {
      calls.import += 1
      if (holder.failImport)
        return { ok: false, error: { code: 'internal', message: 'quota exceeded' } }
      return { ok: true, value: undefined }
    },
    commit: async () => {
      calls.commit += 1
      return { ok: true, value: undefined }
    },
    deleteLegacyCopy: async (legacyModelId) => {
      calls.deleted.push(legacyModelId)
      return { ok: true, value: undefined }
    },
    hasModelMarker: async () => false,
    hasDriverMarker: async () => Boolean(holder.driverDone),
    writeDriverMarker: async () => {
      calls.driverMarker += 1
      holder.driverDone = true
    },
    estimateStorage: async () => ({ quota: 10_000, usage: 0 }),
    ...overrides,
  }

  return { ports, calls, state: holder }
}

describe('the storage gate', () => {
  it('needs the whole legacy library free in normal mode', () => {
    const verdict = assessMigrationStorage({ mode: 'normal', estimate: { quota: 1000, usage: 100 }, rows: [row()] })
    expect(verdict.ok).toBe(true)
    expect(verdict.required).toBe(100)
    expect(verdict.free).toBe(900)
  })

  it('blocks a normal run that does not fit, and offers progressive when that would', () => {
    const rows = [row(), row({ legacyModelId: 'legacy-b', name: 'Beta' })]
    const verdict = assessMigrationStorage({ mode: 'normal', estimate: { quota: 250, usage: 100 }, rows })

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('insufficient-space')
    expect(verdict.recommendation).toBe('progressive')
    expect(verdict.required).toBe(200)

    const progressive = assessMigrationStorage({ mode: 'progressive', estimate: { quota: 250, usage: 100 }, rows })
    expect(progressive.ok).toBe(true)
    expect(progressive.required).toBe(100)
  })

  it('refuses to guess when free space cannot be measured, and recommends progressive', () => {
    const normal = assessMigrationStorage({ mode: 'normal', estimate: undefined, rows: [row()] })
    expect(normal.ok).toBe(false)
    expect(normal.measurable).toBe(false)
    expect(normal.recommendation).toBe('progressive')

    const progressive = assessMigrationStorage({ mode: 'progressive', estimate: undefined, rows: [row()] })
    expect(progressive.ok).toBe(true)
    expect(progressive.measurable).toBe(false)
  })

  it('prefers the driver-declared import size over the compressed legacy size', () => {
    const verdict = assessMigrationStorage({
      mode: 'progressive',
      estimate: { quota: 500, usage: 0 },
      rows: [row({ legacyByteSize: 10, estimatedImportByteSize: 400 })],
    })
    expect(verdict.required).toBe(400)
  })

  it('reports the largest model, so "this can never fit" names it', () => {
    const verdict = assessMigrationStorage({
      mode: 'progressive',
      estimate: { quota: 100, usage: 0 },
      rows: [row({ legacyByteSize: 50 }), row({ legacyModelId: 'legacy-big', name: 'Huge', legacyByteSize: 400 })],
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.largest?.name).toBe('Huge')
    expect(verdict.message).toContain('never')
  })

  it('formats bytes for the surface', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })
})

describe('the queue', () => {
  it('converts character-bound models first, then the rest, each stably', () => {
    const ordered = orderMigrationQueue([
      row({ legacyModelId: 'z', name: 'Zeta', characterBound: false }),
      row({ legacyModelId: 'b', name: 'Beta', characterBound: true }),
      row({ legacyModelId: 'a', name: 'Alpha', characterBound: false }),
    ])
    expect(ordered.map(item => item.legacyModelId)).toEqual(['b', 'a', 'z'])
  })
})

describe('a run', () => {
  it('migrates every model in progressive mode and deletes each legacy copy after its commit', async () => {
    const { ports, calls } = createPorts()
    const report = await runDriverMigration({ driverId: 'driver', mode: 'progressive', ports })

    expect(report.complete).toBe(true)
    expect(report.migrated).toBe(1)
    expect(report.summary).toBe('1 of 1')
    expect(calls.driverMarker).toBe(1)
    expect(calls.deleted).toEqual(['legacy-a'])
  })

  it('keeps the legacy copies in normal mode', async () => {
    const { ports, calls } = createPorts()
    const report = await runDriverMigration({ driverId: 'driver', mode: 'normal', ports })
    expect(report.complete).toBe(true)
    expect(calls.deleted).toEqual([])
  })

  it('parks a refused model on the legacy path and continues the run', async () => {
    const { ports, calls } = createPorts({}, {
      rows: [row(), row({ legacyModelId: 'legacy-b', name: 'Beta' })],
      refuseMigrate: true,
    })
    const report = await runDriverMigration({ driverId: 'driver', mode: 'normal', ports })

    expect(report.parked).toBe(2)
    expect(report.complete).toBe(false)
    expect(report.partial).toBe(true)
    expect(report.results[0]?.reason).toBe('driver-refused')
    expect(calls.driverMarker).toBe(0)
  })

  it('treats retained: false as a park, writes no marker and deletes nothing', async () => {
    const { ports, calls } = createPorts({}, { retain: false })
    const report = await runDriverMigration({ driverId: 'driver', mode: 'progressive', ports })

    expect(report.results[0]?.reason).toBe('retained-false')
    expect(calls.deleted).toEqual([])
    expect(report.complete).toBe(false)
  })

  it('parks a quota shortfall and leaves every committed model standing', async () => {
    const { ports } = createPorts({}, { rows: [row(), row({ legacyModelId: 'legacy-b', name: 'Beta' })] })
    let attempted = 0
    const original = ports.importModel
    ports.importModel = async (input) => {
      attempted += 1
      // Only the first model runs out of space; the second proves the run continued.
      return attempted === 1 ? { ok: false, error: { code: 'internal', message: 'quota exceeded' } } : original(input)
    }

    const report = await runDriverMigration({ driverId: 'driver', mode: 'progressive', ports })

    expect(report.results[0]?.reason).toBe('quota')
    expect(report.results[1]?.status).toBe('migrated')
    expect(report.partial).toBe(true)
  })

  it('resumes a model a previous attempt already imported, without minting a second identity', async () => {
    const imported = new Map([['legacy-a', { modelId: 'model_existing', profileId: 'profile_1' }]])
    const { ports, calls } = createPorts({}, { imported })

    const report = await runDriverMigration({ driverId: 'driver', mode: 'normal', ports })

    expect(report.results[0]?.status).toBe('resumed')
    expect(report.results[0]?.modelId).toBe('model_existing')
    expect(calls.migrate).toBe(0)
    expect(calls.commit).toBe(1)
    expect(report.complete).toBe(true)
  })

  it('stops between models and reports `N of M`', async () => {
    const { ports } = createPorts({}, { rows: [row(), row({ legacyModelId: 'legacy-b', name: 'Beta' })] })
    let visited = 0
    const report = await runDriverMigration({
      driverId: 'driver',
      mode: 'normal',
      ports,
      shouldStop: () => visited++ > 0,
    })

    expect(report.results).toHaveLength(1)
    expect(report.summary).toBe('1 of 2')
    expect(report.partial).toBe(true)
  })

  it('creates nothing when the gate blocks the driver', async () => {
    const { ports, calls } = createPorts({ estimateStorage: async () => ({ quota: 50, usage: 0 }) })
    const report = await runDriverMigration({ driverId: 'driver', mode: 'normal', ports })

    expect(report.blocked).toBe(true)
    expect(calls.migrate).toBe(0)
    expect(calls.import).toBe(0)
  })

  it('is a no-op for a driver that already completed', async () => {
    const { ports, calls } = createPorts({}, { driverDone: true })
    const report = await runDriverMigration({ driverId: 'driver', mode: 'normal', ports })

    expect(report.alreadyComplete).toBe(true)
    expect(calls.migrate).toBe(0)
  })
})
