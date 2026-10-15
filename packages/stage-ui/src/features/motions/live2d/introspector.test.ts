import { introspectCapabilities } from '@proj-airi/stage-ui-live2d'
import { describe, expect, it } from 'vitest'

describe('introspectCapabilities — HitAreas & sound reactions', () => {
  it('extracts hitAreas with enabled/disabled states and motion targets', () => {
    const rawSettings = {
      HitAreas: [
        { Name: 'phone', Id: 'ArtMesh113', Motion: 'phone', Enabled: true },
        { Name: '音乐（进入）', Id: 'ArtMesh121', Motion: '主界面（音乐进入）', Enabled: false },
        { Name: '作者（空间）', Id: 'ArtMesh114', Motion: '作者（空间）', Enabled: false },
      ],
    }

    const caps = introspectCapabilities([], rawSettings)
    expect(caps.hasDsl).toBe(true)
    expect(caps.hitAreas).toHaveLength(3)
    expect(caps.hitAreas[0]).toEqual({
      name: 'phone',
      id: 'ArtMesh113',
      motion: 'phone',
      enabled: true,
    })
    expect(caps.hitAreas[1]).toEqual({
      name: '音乐（进入）',
      id: 'ArtMesh121',
      motion: '主界面（音乐进入）',
      enabled: false,
    })
  })

  it('captures sound-only entries as reactions using groupName fallback', () => {
    const groups = [
      {
        name: '音乐（amadeus）',
        entries: [
          {
            File: 'Motions_音乐（amadeus）_0_File_0.json',
            Sound: 'Motions_音乐（amadeus）_0_Sound_0.mp3',
          },
        ],
      },
      {
        name: '互动（打招呼1）',
        entries: [
          {
            File: 'Motions_互动（打招呼1）_0_File_0.json',
            Sound: 'Motions_互动（打招呼1）_0_Sound_0.wav',
            Weight: 25,
          },
        ],
      },
    ]

    const caps = introspectCapabilities(groups)
    expect(caps.hasDsl).toBe(true)
    expect(caps.reactions).toHaveLength(2)
    expect(caps.reactions[0]).toMatchObject({
      group: '音乐（amadeus）',
      text: '音乐（amadeus）',
      sound: 'Motions_音乐（amadeus）_0_Sound_0.mp3',
    })
    expect(caps.reactions[1]).toMatchObject({
      group: '互动（打招呼1）',
      text: '互动（打招呼1）',
      sound: 'Motions_互动（打招呼1）_0_Sound_0.wav',
    })
  })
})
