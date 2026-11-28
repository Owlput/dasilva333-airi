/**
 * The Live2D import entry (`ModelDriverEntryKind.IMPORT`, RFC 0002 §5.3).
 *
 * This is the driver's half of the host's model-import panel: a module of functions, addressed and loaded exactly
 * like the mount, the panels and the picker — the manager names `LIVE2D_IMPORT_SPECIFIER`, the adapter imports it
 * through its loader table, and the host calls `probe` with the input the user picked.
 *
 * It is deliberately not a second import implementation. `probeLive2DArchive` already owns the two-phase read and
 * the per-part settlement, and `confirmImport` is the callback it hands back, under the ids the host minted. The
 * only thing this entry adds to the provider's `probe` is the same post-commit prompt publication, so a model
 * imported from the host panel is spoken about immediately, whichever surface the user arrived from.
 *
 * `probe` writes nothing. The notification it passes in only says the catalogue may have changed; the host pulls
 * rows after a commit, and a window with no provider entry attached simply has nothing to tell (`live2dSession` is
 * a no-op until a session attaches).
 */
import type {
  ContractResult,
  ModelImportEntry,
  ModelImportEntryOptions,
  ModelProbeInput,
  ModelProbeResult,
} from '@proj-airi/stage-renderer-sdk'

import { probeLive2DArchive } from './import-probe'
import { LIVE2D_DRIVER_ID } from './manifest'
import { publishPromptsForCommittedModels } from './prompt'
import { live2dSession } from './session'

export function createImportEntry(options: ModelImportEntryOptions): ModelImportEntry {
  const services = options.services

  return {
    async probe(input: ModelProbeInput): Promise<ContractResult<ModelProbeResult>> {
      const probed = await probeLive2DArchive({
        input,
        storage: services.storage,
        driverId: LIVE2D_DRIVER_ID,
        notify: () => live2dSession.notifyModelsChanged(),
      })
      if (!probed.ok)
        return probed

      const commit = probed.value.confirmImport
      return {
        ok: true,
        value: {
          ...probed.value,
          confirmImport: async (confirm) => {
            const committed = await commit(confirm)
            if (committed.ok) {
              await publishPromptsForCommittedModels(
                services,
                committed.value.entries.filter(entry => entry.result.ok).map(entry => entry.selection.modelId),
              )
            }
            return committed
          },
        },
      }
    },
  }
}
