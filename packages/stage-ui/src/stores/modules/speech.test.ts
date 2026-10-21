import { describe, expect, it } from 'vitest'

import {
  applyUSTTransformations,
  integerToWords,
  toSignedPercent,
  verbalizePrices,
} from './speech'

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

  describe('integerToWords', () => {
    it('converts single digits and zero', () => {
      expect(integerToWords(0)).toBe('zero')
      expect(integerToWords(7)).toBe('seven')
    })

    it('converts teens and tens', () => {
      expect(integerToWords(13)).toBe('thirteen')
      expect(integerToWords(19)).toBe('nineteen')
      expect(integerToWords(20)).toBe('twenty')
      expect(integerToWords(42)).toBe('forty-two')
      expect(integerToWords(99)).toBe('ninety-nine')
    })

    it('converts hundreds and thousands', () => {
      expect(integerToWords(100)).toBe('one hundred')
      expect(integerToWords(305)).toBe('three hundred five')
      expect(integerToWords(1250)).toBe('one thousand two hundred fifty')
    })

    it('handles negative numbers', () => {
      expect(integerToWords(-5)).toBe('minus five')
    })
  })

  describe('verbalizePrices', () => {
    it('converts dollars and cents naturally', () => {
      expect(verbalizePrices('Your total is $19.99.')).toBe(
        'Your total is nineteen dollars and ninety-nine cents.',
      )
      expect(verbalizePrices('Only $0.50 per ticket')).toBe(
        'Only fifty cents per ticket',
      )
      expect(verbalizePrices('Costs $5!')).toBe(
        'Costs five dollars!',
      )
      expect(verbalizePrices('Total: $1,200.50')).toBe(
        'Total: one thousand two hundred dollars and fifty cents',
      )
    })
  })

  describe('applyUSTTransformations', () => {
    it('returns original text if UST is disabled or undefined', () => {
      expect(applyUSTTransformations('*smiles* $19.99', undefined)).toBe('*smiles* $19.99')
      expect(applyUSTTransformations('*smiles* $19.99', { enabled: false } as any)).toBe('*smiles* $19.99')
    })

    it('processes brackets according to actions: mute, flatten, passThrough, token', () => {
      const baseUst: any = {
        enabled: true,
        asterisks: 'mute',
        squareBrackets: 'flatten',
        parentheses: 'passThrough',
        angleBrackets: 'token',
        stripHtml: false,
        readCurrencyNaturally: false,
      }

      const input = '*giggles* [happy] (whispers) <aside>'
      const output = applyUSTTransformations(input, baseUst)
      expect(output).toBe('happy (whispers) <|aside|>')
    })

    it('handles math formulas mute vs passThrough', () => {
      const ustMuteMath: any = {
        enabled: true,
        mathFormulas: 'mute',
        readCurrencyNaturally: false,
      }
      expect(applyUSTTransformations('Formula $x^2 + y^2 = z^2$ is fun', ustMuteMath)).toBe('Formula is fun')

      const ustPassMath: any = {
        enabled: true,
        mathFormulas: 'passThrough',
        readCurrencyNaturally: false,
      }
      expect(applyUSTTransformations('Formula $x^2 + y^2 = z^2$ is fun', ustPassMath)).toBe('Formula $x^2 + y^2 = z^2$ is fun')
    })

    it('handles chemical notation mute vs passThrough', () => {
      const ustMuteChem: any = {
        enabled: true,
        chemicalNotation: 'mute',
        readCurrencyNaturally: false,
      }
      expect(applyUSTTransformations('Mix \\ce{H2O} and acid', ustMuteChem)).toBe('Mix and acid')

      const ustPassChem: any = {
        enabled: true,
        chemicalNotation: 'passThrough',
        readCurrencyNaturally: false,
      }
      expect(applyUSTTransformations('Mix \\ce{H2O} and acid', ustPassChem)).toBe('Mix \\ce{H2O} and acid')
    })

    it('handles code blocks mute vs passThrough', () => {
      const ustMuteCode: any = {
        enabled: true,
        codeBlocks: 'mute',
        readCurrencyNaturally: false,
      }
      expect(applyUSTTransformations('Start\n```bash\npnpm dev\n```\nDone', ustMuteCode)).toBe('Start\n\nDone')

      const ustPassCode: any = {
        enabled: true,
        codeBlocks: 'passThrough',
        readCurrencyNaturally: false,
      }
      expect(applyUSTTransformations('Start\n```bash\npnpm dev\n```\nDone', ustPassCode)).toBe('Start\n```bash\npnpm dev\n```\nDone')
    })

    it('protects arithmetic multiplication from asterisk muting', () => {
      const ustAsteriskMute: any = {
        enabled: true,
        asterisks: 'mute',
        preserveMathOperators: true,
        readCurrencyNaturally: false,
      }
      expect(applyUSTTransformations('*smiles* 2 * 3 = 6', ustAsteriskMute)).toBe('2 * 3 = 6')
    })
  })
})
