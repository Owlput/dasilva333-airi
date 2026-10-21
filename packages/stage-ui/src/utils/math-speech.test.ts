import { describe, expect, it } from 'vitest'

import {
  braceBareScripts,
  detectSpeechLanguage,
  findBareLatex,
  replaceBalancedCommand,
  speakMath,
  toSpeechLanguage,
} from './math-speech'

describe('math-speech utils', () => {
  describe('toSpeechLanguage', () => {
    it('normalizes locale subtags', () => {
      expect(toSpeechLanguage('en-US')).toBe('en')
      expect(toSpeechLanguage('zh-CN')).toBe('zh')
      expect(toSpeechLanguage('cmn-Hans')).toBe('zh')
      expect(toSpeechLanguage('ja_JP')).toBe('ja')
      expect(toSpeechLanguage('ko-KR')).toBe('ko')
      expect(toSpeechLanguage(undefined)).toBeUndefined()
    })
  })

  describe('detectSpeechLanguage', () => {
    it('detects Japanese from kana', () => {
      expect(detectSpeechLanguage('これは計算です x^2')).toBe('ja')
    })

    it('detects Korean from hangul', () => {
      expect(detectSpeechLanguage('이것은 공식입니다 x^2')).toBe('ko')
    })

    it('detects Chinese from Han characters when fallback is not ja', () => {
      expect(detectSpeechLanguage('这是一个公式 x^2')).toBe('zh')
    })

    it('uses fallback ja when Han characters appear with ja fallback', () => {
      expect(detectSpeechLanguage('計算公式 x^2', 'ja')).toBe('ja')
    })

    it('detects English from Latin words', () => {
      expect(detectSpeechLanguage('The formula is x^2')).toBe('en')
    })
  })

  describe('speakMath', () => {
    it('verbalizes basic equations in English', () => {
      expect(speakMath('x^2 + y^2 = z^2', 'en')).toBe('x squared plus y squared equals z squared')
    })

    it('verbalizes basic equations in Japanese', () => {
      expect(speakMath('x^2 + y^2 = z^2', 'ja')).toBe('エックスの二乗プラスワイの二乗 イコール ゼットの二乗')
    })

    it('verbalizes chemical formulas with mhchem', () => {
      expect(speakMath('\\ce{H2O}', 'en')).toBe('H two O')
      expect(speakMath('\\ce{2H2 + O2 -> 2H2O}', 'en')).toBe('two H two plus O two yields two H two O')
    })
  })

  describe('findBareLatex & braceBareScripts', () => {
    it('finds bare latex fractions and comparisons', () => {
      const text = 'The result is \\frac{1}{2} where \\alpha \\leq 5.'
      const spans = findBareLatex(text)
      expect(spans).toHaveLength(2)
      expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('\\frac{1}{2}')
      expect(text.slice(spans[1]!.start, spans[1]!.end)).toBe('\\alpha \\leq 5')
    })

    it('braces bare multi-digit scripts', () => {
      expect(braceBareScripts('2^10 + x_12')).toBe('2^{10} + x_{12}')
    })
  })

  describe('replaceBalancedCommand', () => {
    it('replaces balanced commands with nested braces', () => {
      const input = 'Water is \\ce{H2O} and complex is \\ce{Fe(CN)_{6}^{4-}}.'
      const result = replaceBalancedCommand(input, 'ce', (_full, inner) => `[${inner}]`)
      expect(result).toBe('Water is [H2O] and complex is [Fe(CN)_{6}^{4-}].')
    })
  })
})
