/**
 * The model prompt: what this driver tells the model about the avatar it is driving (D5, D-10, §10.4).
 *
 * **The driver owns this.** It generates the text from the model's own catalogue, mints the version, stores the
 * pair and publishes it; AIRI keeps only the current copy and the card's portable snapshot, and hands an
 * arbitrated pair back through `prompt.onResolution`. A prompt-capable driver MUST publish at least once per
 * model **and profile** after activation — an empty publication is a value, *no* publication is a fault — which
 * is why `publishAllLive2DPrompts` runs at activation and after every import.
 *
 * Text and tokens are one atomic pair under one `version`, never two writes: AIRI extracts cues with the tokens,
 * so a stale pair makes the model play what the prompt no longer describes (D5).
 *
 * The tokens are the driver's own vocabulary in the exact form AIRI's marker parser resolves:
 * `<|ACT:emotion="happy"|>` and `<|ACT:motion="Idle#0"|>`. A token list that names something the model does not
 * have would be a prompt the user can read but the avatar cannot perform, so both generation and authoring go
 * through the catalogue and drop anything it does not know.
 */
import type {
  HostServices,
  HostStorageInterface,
  ModelId,
  ModelProfileId,
  ModelPromptPublication,
} from '@proj-airi/stage-renderer-sdk'

import type { StoredLive2DModel } from './storage'

import { LIVE2D_DRIVER_ID } from './manifest'
import { readModelRecord } from './storage'

/** One stored publication, in the driver's own namespace. The host's copy is separate on purpose (D26). */
export interface StoredLive2DPrompt {
  text: string
  tokens: string[]
  /** Monotonic per `(model, profile)`; minted here, never by the host (except an arbitration). */
  version: number
  publishedAt: number
}

const promptKey = (modelId: ModelId, profileId: ModelProfileId) => `model/${modelId}/profile/${profileId}/prompt`

export async function readStoredPrompt(
  storage: HostStorageInterface,
  modelId: ModelId,
  profileId: ModelProfileId,
): Promise<StoredLive2DPrompt | undefined> {
  return storage.get<StoredLive2DPrompt>(promptKey(modelId, profileId))
}

export async function writeStoredPrompt(
  storage: HostStorageInterface,
  modelId: ModelId,
  profileId: ModelProfileId,
  prompt: StoredLive2DPrompt,
): Promise<void> {
  await storage.set(promptKey(modelId, profileId), prompt)
}

/** Drop one stored prompt, for a profile that is going away. A model removal takes the whole subtree with it. */
export async function removeStoredPrompt(
  storage: HostStorageInterface,
  modelId: ModelId,
  profileId: ModelProfileId,
): Promise<void> {
  await storage.remove(promptKey(modelId, profileId))
}

/** The token for one expression, in the form AIRI's parser resolves. */
export function expressionToken(key: string): string {
  return `<|ACT:emotion="${key}"|>`
}

/** The token for one motion. The key is this driver's own `group#index`. */
export function motionToken(key: string): string {
  return `<|ACT:motion="${key}"|>`
}

/** Every token this model accepts, expressions first, then motions. */
export function promptTokens(record: StoredLive2DModel): string[] {
  return [
    ...record.expressions.map(expression => expressionToken(expression.key)),
    ...record.motions.map(motion => motionToken(motion.key)),
  ]
}

/**
 * The generated prompt for one model.
 *
 * Deliberately a description of *this* model, not of ACT in general: the generic instruction ("start every reply
 * with an ACT token") is the character's acting prompt, which AIRI composes. Repeating it here would give the
 * model the same rule twice and let the two copies drift.
 */
export function buildLive2DPrompt(record: StoredLive2DModel): { text: string, tokens: string[] } {
  const lines: string[] = [
    `## Live2D avatar: ${record.name}`,
    '',
    'This character is rendered as a Live2D model. Use the tokens below to change its expression or play a motion;',
    'the name inside a token must be copied exactly, and a token for a name that is not listed does nothing.',
    '',
    '### Expressions',
  ]

  if (record.expressions.length > 0) {
    lines.push('Cue one of these to change the face:', '')
    for (const expression of record.expressions)
      lines.push(`- ${expression.label} — \`${expressionToken(expression.key)}\``)
  }
  else {
    lines.push('This model ships no expressions, so emotion is carried by the text and the voice alone.')
  }

  lines.push('', '### Motions')
  if (record.motions.length > 0) {
    lines.push('Cue one of these to move the body:', '')
    for (const motion of record.motions)
      lines.push(`- ${motion.group} #${motion.index} — \`${motionToken(motion.key)}\``)
  }
  else {
    lines.push('This model ships no motions; it holds its idle pose.')
  }

  if (record.hitAreas.length > 0) {
    lines.push('', '### Touchable regions', 'The user can touch these, so react when they do:', '')
    for (const area of record.hitAreas)
      lines.push(`- ${area}`)
  }

  return { text: lines.join('\n'), tokens: promptTokens(record) }
}

const ACT_TOKEN = /<\|ACT:([^|]*)\|>/g
const ACT_PAIR = /([A-Z]+)\s*=\s*"([^"]*)"/gi

/**
 * The tokens an authored text actually uses, narrowed to what this model can perform.
 *
 * Authoring is a text box, so the token list has to come from the text: a token the user wrote but the model
 * cannot perform is dropped rather than published, because publication is what AIRI trusts when it extracts cues.
 * Parameterised forms (`emotion="happy",intensity="0.8"`) reduce to the canonical token so the list stays stable.
 */
export function authoredTokens(text: string, record: StoredLive2DModel): string[] {
  const expressions = new Set(record.expressions.map(expression => expression.key))
  const motions = new Set(record.motions.map(motion => motion.key))
  const tokens: string[] = []

  for (const match of text.matchAll(ACT_TOKEN)) {
    for (const pair of match[1].matchAll(ACT_PAIR)) {
      const [, kind, key] = pair
      const token = kind === 'emotion' && expressions.has(key)
        ? expressionToken(key)
        : kind === 'motion' && motions.has(key)
          ? motionToken(key)
          : undefined
      if (token && !tokens.includes(token))
        tokens.push(token)
    }
  }

  return tokens
}

function publicationFor(
  modelId: ModelId,
  profileId: ModelProfileId,
  prompt: StoredLive2DPrompt,
): ModelPromptPublication {
  return {
    modelDriverId: LIVE2D_DRIVER_ID,
    modelId,
    profileId,
    text: prompt.text,
    tokens: [...prompt.tokens],
    version: prompt.version,
    publishedAt: prompt.publishedAt,
  }
}

/**
 * Publish one model's prompt for one profile, generating the first copy when the driver has none.
 *
 * Publishing the stored pair unchanged is the normal case — activation republishes, it does not re-author — and a
 * repeat is harmless: the host discards a publication that is not strictly newer and answers `stale`.
 */
export async function publishLive2DPrompt(options: {
  services: HostServices
  record: StoredLive2DModel
  profileId: ModelProfileId
  /** Rebuild the text from the catalogue even when a copy is already stored (catalogue changed). */
  regenerate?: boolean
}): Promise<StoredLive2DPrompt> {
  const { services, record, profileId } = options
  const stored = await readStoredPrompt(services.storage, record.modelId, profileId)

  let prompt: StoredLive2DPrompt
  if (!stored || options.regenerate) {
    const generated = buildLive2DPrompt(record)
    const unchanged = stored && stored.text === generated.text
      && stored.tokens.length === generated.tokens.length
      && stored.tokens.every((token, index) => token === generated.tokens[index])
    prompt = unchanged
      ? stored
      : { ...generated, version: (stored?.version ?? 0) + 1, publishedAt: Date.now() }
  }
  else {
    prompt = stored
  }

  if (prompt !== stored)
    await writeStoredPrompt(services.storage, record.modelId, profileId, prompt)
  services.prompt.publish(publicationFor(record.modelId, profileId, prompt))
  return prompt
}

/**
 * Publish every model's prompt for every profile it has.
 *
 * This is what makes "a prompt-capable driver has published at least once per model and profile" true after
 * activation, and what closes the gap after an import — including for a model imported while nothing is mounted.
 */
export async function publishAllLive2DPrompts(
  services: HostServices,
  records: StoredLive2DModel[],
): Promise<void> {
  for (const record of records) {
    for (const profile of record.profiles)
      await publishLive2DPrompt({ services, record, profileId: profile.profileId })
  }
}

/**
 * Publish a prompt for every profile of the models an import just committed.
 *
 * At commit rather than at the next activation, because a viewer may already be open on the model and the panel
 * would otherwise report a fault for a model the user just imported. Both import paths call this — the provider's
 * `probe` and the `./import` entry the host panel loads — so which surface the user imported from cannot change
 * whether the model is spoken about.
 */
export async function publishPromptsForCommittedModels(services: HostServices, modelIds: ModelId[]): Promise<void> {
  for (const modelId of modelIds) {
    const record = await readModelRecord(services.storage, modelId)
    if (record)
      await publishAllLive2DPrompts(services, [record])
  }
}

/**
 * Save an authored prompt and publish it as the next version.
 *
 * The version is `stored + 1` in the driver's own history; that is what keeps an authored copy newer than the one
 * AIRI holds without the host having to mint anything (it mints only after an arbitration, D26).
 */
export async function saveAuthoredPrompt(options: {
  services: HostServices
  record: StoredLive2DModel
  profileId: ModelProfileId
  text: string
}): Promise<StoredLive2DPrompt> {
  const { services, record, profileId, text } = options
  const stored = await readStoredPrompt(services.storage, record.modelId, profileId)
  const prompt: StoredLive2DPrompt = {
    text,
    tokens: authoredTokens(text, record),
    version: (stored?.version ?? 0) + 1,
    publishedAt: Date.now(),
  }
  await writeStoredPrompt(services.storage, record.modelId, profileId, prompt)
  services.prompt.publish(publicationFor(record.modelId, profileId, prompt))
  return prompt
}

/**
 * Record the pair the host arbitrated (D26).
 *
 * Written as-is, including the host's version, so the driver's next publication is strictly newer than the copy
 * AIRI now holds instead of being discarded as stale. It is **not** republished: the host already stored it.
 */
export async function recordPromptResolution(
  storage: HostStorageInterface,
  publication: ModelPromptPublication,
): Promise<void> {
  await writeStoredPrompt(storage, publication.modelId, publication.profileId, {
    text: publication.text,
    tokens: [...publication.tokens],
    version: publication.version,
    publishedAt: publication.publishedAt,
  })
}
