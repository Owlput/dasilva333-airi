/**
 * `{userData}/model-drivers/state.json` — the single owner of the persisted host state (§4.2 step 2, §4.5).
 *
 * Main writes it; a renderer reads it over IPC and never writes it. That is what keeps two facts from having
 * two answers at once: the enable flags (a UI toggle and a manager-existing decision) and
 * `legacy-retention/{driverId}` (a migration fact that a renderer could otherwise move on its own).
 *
 * The rows in here are a **display fallback**, not a source of truth: they are written only from a
 * successful pull and never override an `ok:false` (§4.3). A corrupt file therefore costs a stale model
 * list, never a broken boot — which is why a parse failure degrades to the empty snapshot with a warning
 * instead of throwing.
 */
import type { DriverStateSnapshot } from '@proj-airi/stage-renderer-sdk/host'

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { emptyDriverStateSnapshot } from '@proj-airi/stage-renderer-sdk/host'

export interface ModelDriverStateStore {
  readonly path: string
  read: () => Promise<DriverStateSnapshot>
  write: (snapshot: DriverStateSnapshot) => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Accept only the keys this build understands, and only when their shape is the version 1 shape. */
function coerceSnapshot(raw: unknown): DriverStateSnapshot | undefined {
  if (!isRecord(raw) || raw.version !== 1)
    return undefined

  const snapshot = emptyDriverStateSnapshot()

  if (isRecord(raw.enabled)) {
    for (const [driverId, value] of Object.entries(raw.enabled)) {
      if (typeof value === 'boolean')
        snapshot.enabled[driverId] = value
    }
  }

  if (isRecord(raw.rows)) {
    for (const [driverId, value] of Object.entries(raw.rows)) {
      if (Array.isArray(value))
        snapshot.rows[driverId] = value
    }
  }

  if (isRecord(raw.rowsUpdatedAt)) {
    for (const [driverId, value] of Object.entries(raw.rowsUpdatedAt)) {
      if (typeof value === 'number' && Number.isFinite(value))
        snapshot.rowsUpdatedAt[driverId] = value
    }
  }

  if (isRecord(raw.legacyRetention)) {
    for (const [driverId, value] of Object.entries(raw.legacyRetention)) {
      if (typeof value === 'boolean')
        snapshot.legacyRetention[driverId] = value
    }
  }

  return snapshot
}

export function createModelDriverStateStore(options: {
  path: string
  onWarning?: (message: string) => void
}): ModelDriverStateStore {
  const warn = options.onWarning ?? (() => {})

  return {
    path: options.path,

    async read() {
      let text: string
      try {
        text = await readFile(options.path, 'utf8')
      }
      catch (error) {
        // A missing file is first run, not a failure: defaulting to enabled is the documented behaviour.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          warn(`Could not read \`${options.path}\`; starting from the default host state: ${String(error)}`)
        return emptyDriverStateSnapshot()
      }

      try {
        const snapshot = coerceSnapshot(JSON.parse(text))
        if (!snapshot) {
          warn(`\`${options.path}\` is not a version 1 host state; starting from the default host state`)
          return emptyDriverStateSnapshot()
        }
        return snapshot
      }
      catch (error) {
        warn(`\`${options.path}\` is not valid JSON; starting from the default host state: ${String(error)}`)
        return emptyDriverStateSnapshot()
      }
    },

    async write(snapshot) {
      await mkdir(dirname(options.path), { recursive: true })

      // Write beside the target and rename: a crash mid-write must not leave a half-written file that the
      // next boot would read as "no flags" and silently re-enable a driver the user turned off.
      const temporary = `${options.path}.tmp`
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8')
      await rename(temporary, options.path)
    },
  }
}
