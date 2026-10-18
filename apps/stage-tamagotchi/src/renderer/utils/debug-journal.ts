import { useTextJournalStore } from '@proj-airi/stage-ui/stores/memory-text-journal'

// NOTICE: This helper lives at module scope (not inside App.vue setup) so that
// assigning it to `window` for DevTools debugging never retains the App setup
// scope — and with it the entire chatSessionStore + reactive sessionMessages —
// permanently on `window`. The store instance is resolved lazily on each call.
export async function seedTextJournalEntryFromWindow() {
  const textJournalStore = useTextJournalStore()
  await textJournalStore.load()
  const entry = await textJournalStore.seedActiveCharacterEntry()
  console.info('[TextJournal] Seeded entry via window.seedTextJournalEntry()', entry)
  return entry
}
