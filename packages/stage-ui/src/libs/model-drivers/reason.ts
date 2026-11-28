/**
 * The translation key for one §5.6 unavailable reason.
 *
 * `UnavailableModelReason` is AIRI's own vocabulary and more than one view renders it (`AiriModelPicker`'s banner,
 * `UnavailableModelView`'s copy), so the key is built in one place: a new reason on the contract then fails the
 * `reason.test.ts` case that walks the enum, instead of silently rendering an enum value into the user's language.
 */
import type { UnavailableModelReason } from '@proj-airi/stage-renderer-sdk'

/** Every reason label lives under the model-driver settings surface, next to the views that show them. */
const PREFIX = 'settings.pages.models.model-drivers.reason'

export function unavailableReasonKey(reason: UnavailableModelReason): string {
  return `${PREFIX}.${reason}`
}
