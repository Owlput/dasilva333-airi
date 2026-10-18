import { describe, expect, it } from 'vitest'

import { buildSnapshotHeader, isSnapshotCompatible } from './embedding-format'

describe('snapshot watermark', () => {
  it('stores the provided lastIndexedTurnAt in the header', () => {
    expect(buildSnapshotHeader(12345).lastIndexedTurnAt).toBe(12345)
  })

  it('defaults lastIndexedTurnAt to 0 when unknown', () => {
    expect(buildSnapshotHeader().lastIndexedTurnAt).toBe(0)
  })

  it('treats pre-watermark headers (field absent) as compatible', () => {
    const legacy = buildSnapshotHeader(999)
    delete legacy.lastIndexedTurnAt
    expect('lastIndexedTurnAt' in legacy).toBe(false)
    expect(isSnapshotCompatible(legacy)).toBe(true)
  })

  it('still rejects mismatched model generations', () => {
    expect(isSnapshotCompatible({ ...buildSnapshotHeader(1), embeddingDim: 384 })).toBe(false)
    expect(isSnapshotCompatible(null)).toBe(false)
  })
})
