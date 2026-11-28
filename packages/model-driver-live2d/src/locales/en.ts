/**
 * The Live2D driver's own UI records, in English.
 *
 * **These records ship with the driver, not with AIRI's locale tree.** The driver's picker and panels are mounted by
 * whatever host wants them, so the strings a user reads while choosing or configuring a Live2D model belong to the
 * package that knows what a Live2D model is; `packages/i18n` keeps host surfaces only. The tree is self-namespacing —
 * everything sits under `model-drivers.live2d` — so the host can merge this file blind, and two drivers can each
 * contribute their own subtree under `model-drivers.{format}` without agreeing on anything first (P3-D23).
 *
 * A new language is a sibling file plus a row in `./index.ts`; a host that merges the bundle and falls back to `en`
 * needs no change to pick it up.
 */
export default {
  'model-drivers': {
    live2d: {
      error: {
        // One shared failure: every panel that reads the catalogue can find the row gone between mount and load.
        'model-missing': 'No Live2D model `{modelId}` in this driver\'s storage',
      },
      picker: {
        'title': 'Live2D models',
        'cancel': 'Cancel',
        'loading': 'Reading this driver\'s catalogue…',
        'empty': 'This driver holds no Live2D models yet.',
        'empty-import': 'Import one with the button below; the picker never creates a model on its own.',
        'empty-no-import': 'Importing one needs the host\'s model-import panel, which this window did not offer.',
        'profile-count': '{count} profiles',
        'profile-count-one': '1 profile',
        'current': 'current',
        'by-author': 'by {author}',
        'meta-model': 'Model',
        'meta-size': 'Size',
        'meta-imported': 'Imported',
        'meta-catalogue': 'Catalogue',
        'meta-catalogue-value': '{expressions} expressions · {motions} motions · {hitAreas} hit areas',
        'profile-label': 'Profile',
        'profile-in-use': '(in use)',
        'action-import': 'Import model…',
        'action-confirm': 'Confirm',
        'footnote': 'Confirm emits the model and profile AIRI will use. A prompt is per model and profile, so switching profile reads that profile\'s prompt. Import opens AIRI\'s import panel; the picker never mints an identity.',
      },
      appearance: {
        'no-profile': 'This panel edits a profile, and no profile is selected. Pick one in the model picker.',
        'profile': 'Profile',
        'default': 'default appearance',
        'saved': 'saved',
        'scale': 'Scale',
        'anchor': 'Vertical anchor',
        'opacity': 'Opacity',
        'offset-x': 'Offset X (px)',
        'offset-y': 'Offset Y (px)',
        'resting-expression': 'Resting expression',
        'keep-last-cue': '(keep the last cue)',
        'reset': 'Reset to default appearance',
        'read-only': 'Read only: this panel was mounted for viewing.',
        'profile-gone': 'The profile `{profileId}` is gone; nothing was written',
      },
      capabilities: {
        'readiness': 'Readiness:',
        'expressions': 'Expressions ({count})',
        'no-expressions': 'This model ships no expressions.',
        'motions': 'Motions ({count})',
        'no-motions': 'This model ships no motions.',
        'hit-areas': 'Touchable regions ({count})',
        'no-hit-areas': 'This model declares no hit areas, so a touch reaches the stage rather than the model.',
        'footnote': 'Previews are transient: they do not change the stored appearance of this profile.',
        'sending': 'sending...',
        'send-failed': 'Send failed: {message}',
        'settlement-failed': 'Settlement failed: {message}',
        'refused': 'refused: {reason}',
        'applied': 'applied',
      },
      prompt: {
        'no-profile': 'A prompt is per model and profile; no profile is selected.',
        'stored': 'Stored version {version} · {tokens} token(s) · published {date}',
        'nothing': 'Nothing published yet for this model and profile. A prompt-capable driver that publishes nothing is a fault; an empty prompt that was published is a value.',
        'placeholder': 'The model prompt: what the avatar can do, in the tokens it can perform.',
        'action-save': 'Save & publish',
        'action-regenerate': 'Regenerate from model',
        'unsaved': 'unsaved changes',
        'published': 'Published version {version} with {count} token(s)',
        'publish-failed': 'Publish failed: {message}',
        'regenerated': 'Regenerated version {version} from the model\'s catalogue',
        'regenerate-failed': 'Regenerate failed: {message}',
        'tokens-heading': 'Published tokens',
        'footnote': 'The token list is derived from the text: only tokens naming an expression or motion this model performs are published.',
      },
    },
  },
}
