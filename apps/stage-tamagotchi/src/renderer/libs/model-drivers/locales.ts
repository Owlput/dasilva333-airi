/**
 * The locale records the installed drivers bring with them (P3-D23).
 *
 * **A driver owns the strings its own UI shows.** The Live2D picker and its three panels are the driver's surfaces,
 * mounted by host frames but authored by the package that knows what a Live2D model is, so its records ship inside
 * `@proj-airi/model-driver-live2d` rather than in `@proj-airi/i18n`. The host merges them verbatim: every record is
 * already namespaced (`model-drivers.live2d.*`), so `modules/i18n.ts` needs no per-driver path and this list is the
 * only thing that names a driver here.
 *
 * Two rules keep it honest:
 *
 *   - **one row per installed driver**, beside the loader table and the specifiers, because a driver that ships UI but
 *     no records renders key strings — visible, but a placeholder where the rest of the app is translated;
 *   - **message data only**: this module runs at renderer startup for every window, so importing a driver here must
 *     pull in plain records and nothing else (its `./locales` entry is that by construction).
 */
import live2d from '@proj-airi/model-driver-live2d/locales'

/** Every installed driver's bundle, merged into this window's i18n before the app is mounted. */
export const installedDriverLocales = [
  live2d,
]
