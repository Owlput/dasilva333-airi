/**
 * Prompt publication: generation, authoring, versioning and the resolution hand-back.
 *
 * Everything here is DOM-free and runs on a memory storage port, because the two things that can silently break are
 * what the text teaches* and *which version wins* — neither of which a WebGL test would catch. The memory port is the
 * same shape the host provides: JSON values, keyed, with `watch`.
 */
import type { HostServices, HostStorageInterface, ModelPromptPublication } from '@proj-airi/stage-renderer-sdk'

import type { StoredLive2DModel } from './storage'

import { describe, expect, it } from 'vitest'

import { LIVE2D_DRIVER_ID } from './manifest'
import {
  authoredTokens,
  buildLive2DPrompt,
  expressionToken,
  motionToken,
  promptTokens,
  publishAllLive2DPrompts,
  publishLive2DPrompt,
  readStoredPrompt,
  recordPromptResolution,
  removeStoredPrompt,
  saveAuthoredPrompt,
} from './prompt'

function memoryStorage(): HostStorageInterface {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    set: async <T>(key: string, value: T) => {
      values.set(key, value)
    },
    remove: (key: string) => {
      values.delete(key)
      return Promise.resolve()
    },
    keys: () => Promise.resolve([...values.keys()]),
    watch: () => () => {},
  }
}

function fakeServices(storage: HostStorageInterface): { services: HostServices, published: ModelPromptPublication[] } {
  const published: ModelPromptPublication[] = []
  const services = {
    modelDriverId: LIVE2D_DRIVER_ID,
    storage,
    prompt: {
      publish: (publication: ModelPromptPublication) => {
        published.push(publication)
      },
      onResolution: () => () => {},
    },
  } as unknown as HostServices
  return { services, published }
}

const MODEL: StoredLive2DModel = {
  modelId: 'model_1',
  name: 'Hiyori',
  importedAt: 1,
  byteSize: 3,
  settingsFile: 'Hiyori.model3.json',
  profiles: [{ profileId: 'profile_1', name: 'Default' }, { profileId: 'profile_2', name: 'Nighty' }],
  expressions: [{ key: 'happy', label: 'Happy' }, { key: 'sad', label: 'Sad' }],
  motions: [{ key: 'Idle#0', group: 'Idle', index: 0 }],
  hitAreas: ['Head'],
}

describe('live2d prompt', () => {
  it('teaches exactly the tokens the catalogue can perform', () => {
    const prompt = buildLive2DPrompt(MODEL)

    expect(prompt.tokens).toEqual([
      expressionToken('happy'),
      expressionToken('sad'),
      motionToken('Idle#0'),
    ])
    expect(prompt.text).toContain('Hiyori')
    for (const token of prompt.tokens)
      expect(prompt.text).toContain(token)
    expect(prompt.text).toContain('Head')
    // The generic ACT instruction belongs to the character's acting prompt, not to a model description.
    expect(prompt.text).not.toContain('Start every reply')
  })

  it('says so, rather than staying silent, when a model has no expressions or motions', () => {
    const prompt = buildLive2DPrompt({ ...MODEL, expressions: [], motions: [], hitAreas: [] })

    expect(promptTokens(MODEL).length).toBe(3)
    expect(prompt.tokens).toEqual([])
    expect(prompt.text).toContain('ships no expressions')
    expect(prompt.text).toContain('ships no motions')
    expect(prompt.text).not.toContain('Touchable regions')
  })

  it('derives the published token list from authored text and drops what the model cannot perform', () => {
    const tokens = authoredTokens([
      `Nice. ${expressionToken('happy')}`,
      `Running: ${expressionToken('angry')}`,
      `Move: ${motionToken('Idle#0')}`,
      `Move: ${motionToken('Wave#2')}`,
      // Parameterised and combined forms reduce to the canonical token; the parameters are the model's business.
      '<|ACT:emotion="sad",intensity="0.8",motion="Idle#0"|>',
      // A token that names nothing in this model is not published: AIRI trusts the list when it extracts cues.
      '<|ACT:emotion="dance"|>',
    ].join(' '), MODEL)

    expect(tokens).toEqual([
      expressionToken('happy'),
      motionToken('Idle#0'),
      expressionToken('sad'),
    ])
  })

  it('publishes version 1 on the first call, repeats the stored version, and only bumps on a real change', async () => {
    const storage = memoryStorage()
    const { services, published } = fakeServices(storage)

    const first = await publishLive2DPrompt({ services, record: MODEL, profileId: 'profile_1' })
    expect(first.version).toBe(1)
    expect(published).toHaveLength(1)
    expect(published[0].modelId).toBe('model_1')
    expect(published[0].profileId).toBe('profile_1')
    expect(published[0].tokens).toEqual(first.tokens)

    // Activation republishes; the host discards a non-newer publication, and re-authoring on every activation would
    // be a version storm that looks like a conflict.
    const second = await publishLive2DPrompt({ services, record: MODEL, profileId: 'profile_1' })
    expect(second.version).toBe(1)
    expect(published).toHaveLength(2)
    expect(published[1].version).toBe(1)

    // The catalogue changed, so the generated text did too: one new version, not a silent overwrite.
    const regenerated = await publishLive2DPrompt({
      services,
      record: { ...MODEL, expressions: [...MODEL.expressions, { key: 'cool', label: 'Cool' }] },
      profileId: 'profile_1',
      regenerate: true,
    })
    expect(regenerated.version).toBe(2)
    expect(regenerated.tokens).toContain(expressionToken('cool'))
  })

  it('does not bump a version when regeneration produces the same text', async () => {
    const storage = memoryStorage()
    const { services } = fakeServices(storage)

    const first = await publishLive2DPrompt({ services, record: MODEL, profileId: 'profile_1' })
    const again = await publishLive2DPrompt({ services, record: MODEL, profileId: 'profile_1', regenerate: true })

    expect(again.version).toBe(first.version)
    expect(again.publishedAt).toBe(first.publishedAt)
  })

  it('publishes once per profile, because a prompt is per model and profile', async () => {
    const storage = memoryStorage()
    const { services, published } = fakeServices(storage)

    await publishAllLive2DPrompts(services, [MODEL])

    expect(published.map(publication => publication.profileId)).toEqual(['profile_1', 'profile_2'])
    expect(await readStoredPrompt(storage, 'model_1', 'profile_2')).toBeDefined()
  })

  it('saves an authored prompt as the next version, for that profile only', async () => {
    const storage = memoryStorage()
    const { services, published } = fakeServices(storage)
    await publishAllLive2DPrompts(services, [MODEL])

    const authored = await saveAuthoredPrompt({
      services,
      record: MODEL,
      profileId: 'profile_2',
      text: `Nighty only: ${expressionToken('sad')}`,
    })

    expect(authored.version).toBe(2)
    expect(authored.tokens).toEqual([expressionToken('sad')])
    expect((await readStoredPrompt(storage, 'model_1', 'profile_1'))?.version).toBe(1)
    expect(published.at(-1)?.profileId).toBe('profile_2')
  })

  it('records an arbitrated pair so the next publication is strictly newer than what AIRI holds', async () => {
    const storage = memoryStorage()
    const { services, published } = fakeServices(storage)
    await publishLive2DPrompt({ services, record: MODEL, profileId: 'profile_1' })

    const arbitrated: ModelPromptPublication = {
      modelDriverId: LIVE2D_DRIVER_ID,
      modelId: 'model_1',
      profileId: 'profile_1',
      text: 'user-chosen text',
      tokens: [],
      version: 7,
      publishedAt: 99,
    }
    await recordPromptResolution(storage, arbitrated)

    const stored = await readStoredPrompt(storage, 'model_1', 'profile_1')
    expect(stored?.version).toBe(7)
    // Recording is not publishing: the host already stored this pair.
    expect(published).toHaveLength(1)

    const next = await publishLive2DPrompt({ services, record: MODEL, profileId: 'profile_1', regenerate: true })
    expect(next.version).toBe(8)
  })

  it('removes a profile prompt without touching its sibling', async () => {
    const storage = memoryStorage()
    const { services } = fakeServices(storage)
    await publishAllLive2DPrompts(services, [MODEL])

    await removeStoredPrompt(storage, 'model_1', 'profile_1')

    expect(await readStoredPrompt(storage, 'model_1', 'profile_1')).toBeUndefined()
    expect(await readStoredPrompt(storage, 'model_1', 'profile_2')).toBeDefined()
  })
})
