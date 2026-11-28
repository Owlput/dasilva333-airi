/**
 * The panels entry.
 *
 * Only the declarations are asserted: resolving a component means importing a `.vue` file, which is the host's job
 * (`DriverPanelHost`) and needs an SFC build this Node suite does not have. What can be checked here is the part the
 * adapter validates — unique ids, labels an i18n lookup can try, and a lazy factory per panel — plus the fact that the
 * driver declares the three panels it advertises through `capabilities.panels`.
 */
import { describe, expect, it } from 'vitest'

import { declarations } from './panels'

describe('live2d panels', () => {
  it('declares appearance, prompt and capabilities, in that order', () => {
    expect(declarations().map(panel => panel.id)).toEqual([
      'live2d-appearance',
      'live2d-prompt',
      'live2d-capabilities',
    ])
  })

  it('gives every panel a label and a lazy component factory', () => {
    for (const panel of declarations()) {
      expect(panel.label.length).toBeGreaterThan(0)
      expect(typeof panel.component).toBe('function')
    }
  })

  it('does not restrict its panels to a surface', () => {
    // A profile is editable with no stage in the window, so a `surfaces` filter would hide the only UI that can edit
    // it. The host decides where a panel is offered; the driver does not narrow it without a reason.
    for (const panel of declarations()) {
      expect(panel.surfaces).toBeUndefined()
      expect(panel.hostSurfaces).toBeUndefined()
    }
  })

  it('answers a fresh list each call, so a host cannot mutate the driver\'s declaration', () => {
    const first = declarations()
    first.push({ id: 'injected', label: 'Injected', component: async () => ({ default: {} as never }) })

    expect(declarations()).toHaveLength(3)
  })
})
