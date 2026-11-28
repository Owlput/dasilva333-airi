/**
 * The Live2D panels entry (RFC 0002 §11).
 *
 * The declarations are a function rather than a constant because the adapter accepts either, and a function keeps
 * each panel's component out of the window's first paint: `component()` is the lazy import the host calls only when
 * that tab is active. Three panels is the whole of this driver's settings UI — appearance, prompt, capabilities —
 * and the host decides where they appear; the driver only says what it has.
 */
import type { ModelDriverPanelDeclaration } from '@proj-airi/stage-renderer-sdk'

export function declarations(): ModelDriverPanelDeclaration[] {
  return [
    {
      id: 'live2d-appearance',
      label: 'Appearance',
      // A profile is a stage-shaped thing; a settings page with no stage still edits it, so no `surfaces` filter.
      component: () => import('./Live2DAppearancePanel.vue'),
    },
    {
      id: 'live2d-prompt',
      label: 'Prompt',
      component: () => import('./Live2DPromptPanel.vue'),
    },
    {
      id: 'live2d-capabilities',
      label: 'Capabilities',
      component: () => import('./Live2DCapabilitiesPanel.vue'),
    },
  ]
}
