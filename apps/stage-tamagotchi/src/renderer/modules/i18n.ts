import messages from '@proj-airi/i18n/locales'

import { createI18n } from 'vue-i18n'

import { installedDriverLocales } from '../libs/model-drivers/locales'

const languageRemap: Record<string, string> = {
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'zh-HK': 'zh-Hant',
  'en-US': 'en',
  'en-GB': 'en',
  'en-AU': 'en',
  'en': 'en',
  'es-ES': 'es',
  'es-MX': 'es',
  'es-AR': 'es',
  'es': 'es',
  'vi': 'vi',
  'vi-VN': 'vi',
  'ru': 'ru',
  'ru-RU': 'ru',
}

function getLocale() {
  let language = localStorage.getItem('settings/language')
  const languages = Object.keys(messages!)

  if (languageRemap[language || 'en'] != null) {
    language = languageRemap[language || 'en']
  }
  if (language && languages.includes(language))
    return language

  return 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: getLocale(),
  fallbackLocale: 'en',
  messages,
})

// Drivers ship the records their own UI shows (P3-D23). They are merged after the instance exists rather than spread
// into `messages` above, because a driver's bundle is one message tree per language, already namespaced
// (`model-drivers.live2d.*`); merging is deep, so two drivers never collide and a missing language falls back through
// `fallbackLocale` like any other untranslated key.
for (const bundle of installedDriverLocales) {
  for (const [locale, driverMessages] of Object.entries(bundle))
    i18n.global.mergeLocaleMessage(locale, driverMessages)
}
