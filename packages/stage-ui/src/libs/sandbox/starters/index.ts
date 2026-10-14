import type { WidgetExportManifest } from '../export'

import { DAILY_CHECKLIST_STARTER } from './daily-checklist'

export * from './daily-checklist'

export const BUNDLED_STARTER_WIDGETS: WidgetExportManifest[] = [
  DAILY_CHECKLIST_STARTER,
]
