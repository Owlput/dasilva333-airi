import type { VoiceProfile } from '../providers'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toSignedPercent, useSpeechStore } from './speech'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    te: () => true,
    locale: { value: 'en-US' },
  }),
}))

function createMockProfile(overrides: Partial<VoiceProfile['ust']> = {}): VoiceProfile {
  return {
    id: 'test-profile-1',
    name: 'Test Voice',
    baseProvider: 'speech-noop',
    baseModel: 'noop-model',
    baseVoice: 'noop-voice',
    effects: {
      pitch: 0,
      rate: 1,
      volume: 100,
      asmr: 0,
      radio: 0,
      robot: 0,
      reverb: 0,
      spatial: 0,
    },
    ust: {
      enabled: true,
      asterisks: 'flatten',
      squareBrackets: 'mute',
      parentheses: 'ignore',
      angleBrackets: 'flatten',
      customBracketEnabled: false,
      customBracketStart: '',
      customBracketEnd: '',
      customBracketAction: 'ignore',
      stripEmojis: false,
      stripSymbols: false,
      tildeReplacement: '',
      customReplacements: [],
      stripCodeBlocks: true,
      stripHtml: true,
      preserveMarkdownLinks: 'extract_text',
      preserveMathOperators: true,
      normalizeBlockPauses: true,
      ...overrides,
    },
  }
}

describe('speech store helpers', () => {
  it('formats positive percentages with a plus sign', () => {
    expect(toSignedPercent(25)).toBe('+25%')
  })

  it('formats negative percentages without a double minus', () => {
    expect(toSignedPercent(-20)).toBe('-20%')
    expect(toSignedPercent(-20)).not.toContain('--')
  })

  it('formats zero as 0%', () => {
    expect(toSignedPercent(0)).toBe('0%')
  })
})

describe('uST speech transformation pipeline', () => {
  let speechStore: ReturnType<typeof useSpeechStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    speechStore = useSpeechStore()
  })

  describe('baseline & bypass behaviors', () => {
    it('bypasses transformation for direct chatterbox or airi-audio-server providers', () => {
      const text = '*giggles* [link](https://test.com) <div>hello</div>'
      expect(speechStore.transformTextForSpeech(text, 'chatterbox')).toBe(text)
      expect(speechStore.transformTextForSpeech(text, 'airi-audio-server')).toBe(text)
    })

    it('returns raw text unchanged if profile has ust disabled', () => {
      const profile = createMockProfile({ enabled: false })
      speechStore.savedVoiceProfiles = [profile]

      const text = '*giggles* hello'
      expect(speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)).toBe(text)
    })

    it('strips markdown image embeds unconditionally', () => {
      const profile = createMockProfile()
      speechStore.savedVoiceProfiles = [profile]

      const text = 'Here is a photo: ![cute cat](https://example.com/cat.png) look at it!'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result).toBe('Here is a photo: look at it!')
    })
  })

  describe('bracket action behaviors', () => {
    it('flattens asterisks and mutes square brackets according to profile configuration', () => {
      const profile = createMockProfile({
        asterisks: 'flatten',
        squareBrackets: 'mute',
      })
      speechStore.savedVoiceProfiles = [profile]

      const text = 'This is **important** and [action note] done.'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result).toBe('This is important and done.')
    })

    it('mutes roleplay asterisks when asterisks are set to mute', () => {
      const profile = createMockProfile({
        asterisks: 'mute',
      })
      speechStore.savedVoiceProfiles = [profile]

      const text = '*smiles warmly* Good morning, master!'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result.trim()).toBe('Good morning, master!')
    })

    it('converts bracketed content to tokens when mode is token', () => {
      const profile = createMockProfile({
        parentheses: 'token',
      })
      speechStore.savedVoiceProfiles = [profile]

      const text = 'She looked away (blushing).'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result).toBe('She looked away <|blushing|>.')
    })
  })

  describe('emoji, symbol & tilde transformations', () => {
    it('strips emojis when stripEmojis is enabled', () => {
      const profile = createMockProfile({ stripEmojis: true })
      speechStore.savedVoiceProfiles = [profile]

      const text = 'Hello world! 🌸✨🎉'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result.trim()).toBe('Hello world!')
    })

    it('substitutes tildes with custom replacement word', () => {
      const profile = createMockProfile({ tildeReplacement: 'nyan' })
      speechStore.savedVoiceProfiles = [profile]

      const text = 'Good morning~'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result).toBe('Good morning nyan')
    })
  })

  describe('uST V2 Markdown & Speech Sanitization (#3014)', () => {
    it('strips multiline and single-line fenced code blocks by default', () => {
      const profile = createMockProfile()
      speechStore.savedVoiceProfiles = [profile]

      const text = 'Before code.\n```typescript\nconst a = 1\nconsole.log(a)\n```\nAfter code.'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result).toBe('Before code.\n\nAfter code.')
    })

    it('strips raw HTML elements by default', () => {
      const profile = createMockProfile()
      speechStore.savedVoiceProfiles = [profile]

      const text = 'Text before <div>hidden tag</div> and <br/> after.'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result).toBe('Text before hidden tag and after.')
    })

    it('extracts text from markdown links by default without verbalizing URLs', () => {
      const profile = createMockProfile({
        squareBrackets: 'mute', // Ensure bracket muting does not wipe out link text!
        preserveMarkdownLinks: 'extract_text',
      })
      speechStore.savedVoiceProfiles = [profile]

      const text = 'Read [the project documentation](https://airi.wiki/guide) before proceeding.'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result).toBe('Read the project documentation before proceeding.')
    })

    it('mutes markdown links completely when preserveMarkdownLinks is mute', () => {
      const profile = createMockProfile({
        preserveMarkdownLinks: 'mute',
      })
      speechStore.savedVoiceProfiles = [profile]

      const text = 'Read [the project documentation](https://airi.wiki/guide) before proceeding.'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result).toBe('Read before proceeding.')
    })

    it('preserves arithmetic operators (* and **) between ASCII operands even when asterisks are muted', () => {
      const profile = createMockProfile({
        asterisks: 'mute',
        preserveMathOperators: true,
      })
      speechStore.savedVoiceProfiles = [profile]

      const text = '*giggles* The answer to 2 * 3 is 6, and 2**10 is 1024.'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result.trim()).toBe('The answer to 2 * 3 is 6, and 2**10 is 1024.')
    })

    it('normalizes markdown headers, blockquotes, and lists into natural pauses', () => {
      const profile = createMockProfile({
        normalizeBlockPauses: true,
      })
      speechStore.savedVoiceProfiles = [profile]

      const text = '# Morning Briefing\n\n> Important quote\n\n- First agenda\n* Second agenda\n1. Final step'
      const result = speechStore.transformTextForSpeech(text, 'virtual-audio-studio', profile.id)
      expect(result).toBe('Morning Briefing\n\nImportant quote\n\nFirst agenda\nSecond agenda\nFinal step')
    })
  })
})
