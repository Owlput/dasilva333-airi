/**
 * The Live2D driver's locale records, keyed by language.
 *
 * Shape: `{ [locale]: messageTree }` — exactly what a host merges into its instance
 * (`i18n.global.mergeLocaleMessage(locale, messages)` for each entry). The host is deliberately dumb here: it merges
 * the file verbatim, so the namespacing lives in the records (`model-drivers.live2d.*`) rather than in a host-side
 * path, and adding a language is a row in this table plus nothing on the host side (P3-D23).
 *
 * It is left un-annotated on purpose: `vue-i18n`'s `LocaleMessages` is a schema-generic alias, and the literal shape
 * of `./en` is already a `LocaleMessage` a host can merge. Annotating it would either widen the literals to `any` or
 * fight the generic for no gain.
 *
 * Importing this module must stay cheap and side-effect free: the app merges it at startup, before any driver
 * component exists, so it may not pull Vue components, Pixi or the model loader in with it.
 */
import en from './en'

const locales = {
  en,
}

export default locales
