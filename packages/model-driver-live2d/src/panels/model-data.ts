/**
 * What every Live2D panel needs: the model record and the profile it is editing, read from driver storage.
 *
 * A panel reads the driver's own storage directly — that is the contract's arrangement (§11: "a panel never writes
 * AIRI state; it edits the driver's own storage") — and never goes through the provider entry's module-level
 * helpers, so a panel costs no session and no Pixi.
 */
import type { HostServices, ModelId, ModelProfileId } from '@proj-airi/stage-renderer-sdk'

import type { Live2DProfileBody } from '../profile'
import type { StoredLive2DModel, StoredLive2DProfile } from '../storage'

import { normalizeProfileBody } from '../profile'
import { readModelRecord, readProfile, writeProfileBody } from '../storage'

export interface Live2DPanelData {
  record?: StoredLive2DModel
  profile?: StoredLive2DProfile
  body: Live2DProfileBody
}

export async function loadPanelData(
  services: HostServices,
  modelId: ModelId,
  profileId?: ModelProfileId,
): Promise<Live2DPanelData> {
  const record = await readModelRecord(services.storage, modelId)
  const profile = profileId ? await readProfile(services.storage, modelId, profileId) : undefined
  return { record, profile, body: normalizeProfileBody(profile?.body) }
}

/**
 * Persist one profile body.
 *
 * No cue is sent: a live mount in this window or another one watches the profile key and re-applies the body, which
 * is what the storage port's `watch` is for. Writing straight to storage also means a profile is editable with no
 * mount, as `saveProfile` requires (D-9).
 */
export async function saveProfileBody(options: {
  services: HostServices
  modelId: ModelId
  profileId: ModelProfileId
  body: Live2DProfileBody
}): Promise<boolean> {
  const written = await writeProfileBody(
    options.services.storage,
    options.modelId,
    options.profileId,
    normalizeProfileBody(options.body),
  )
  return written !== undefined
}
