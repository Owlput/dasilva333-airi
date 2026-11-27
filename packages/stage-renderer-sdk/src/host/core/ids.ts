/**
 * Identity minting: the one authority the adapter holds that nothing else may have (D4, §4.5, P1-D27).
 *
 * Three rules decide this file:
 *
 *   - **`modelId` and `profileId` are minted, never adopted.** A legacy `DisplayModel.id` survives only
 *     as provenance in the driver's retained handover and in a card's frozen
 *     `modules.displayModelId`; it never becomes a new identity.
 *   - **`mountId` is not minted here.** The registry issues it (`mounts.ts`), so a renderer cannot
 *     construct one. Nothing in this module can produce a mount id, which is what makes the contract's
 *     "no `mintMountId` on the adapter" true in code rather than in prose.
 *   - **the call is synchronous**, because `Adapter.mintModelId(): ModelId` is (the contract has no
 *     `MaybePromise` there, and a caller that had to await an id could not build an import in one
 *     step). So uniqueness cannot be a storage round-trip; see {@link createIdMinter}.
 */

const PREFIXES = {
  model: 'model_',
  profile: 'profile_',
  mount: 'mount_',
} as const

/** What kind of host-issued identity a value is, by its prefix. For diagnostics and tests only. */
export type HostIdKind = 'model' | 'profile' | 'mount' | 'unknown'

export function classifyHostId(id: string): HostIdKind {
  if (id.startsWith(PREFIXES.model))
    return 'model'
  if (id.startsWith(PREFIXES.profile))
    return 'profile'
  if (id.startsWith(PREFIXES.mount))
    return 'mount'
  return 'unknown'
}

function randomToken(): string {
  const crypto = globalThis.crypto as Crypto | undefined
  if (crypto && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()

  // A host with no `randomUUID` (an old runtime, a stripped-down test environment) still needs unique
  // ids. 128 random bits from `Math.random` are weaker than a UUID but far above what a collision
  // needs, and the issued-id set below is the real guard against a repeat within one session.
  const bytes = new Uint8Array(16)
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Math.floor(Math.random() * 256)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export interface IdMinter {
  mintModelId: () => string
  mintProfileId: () => string
  /** Every id this minter has handed out, so a caller can answer "is this one of mine" synchronously. */
  readonly issued: ReadonlySet<string>
}

export interface IdMinterOptions {
  /**
   * Override the random source.
   *
   * Exists so a test can force a collision and prove the minted-id set catches it — the one failure a
   * random minter cannot otherwise demonstrate.
   */
  random?: () => string
}

/**
 * Create the minter for one adapter (one window).
 *
 * **Uniqueness, honestly stated.** The mint is synchronous, so it cannot check storage before it
 * answers. What it does guarantee:
 *
 *   1. 122+ random bits per id, which makes a collision between two mints an event with negligible
 *      probability — the same guarantee a UUID has anywhere else;
 *   2. no two ids this minter hands out are equal, because it records what it issued and re-rolls
 *      until the value is new. A broken random source therefore produces a fresh id or an exception,
 *      never a duplicate;
 *   3. the record store refuses a create under an id that already has a record
 *      (`ContractFailureCode.MODEL_ID_CONFLICT`), which is the check the contract actually needs — it
 *      answers "is this id free *now*" at the moment the record is written, which is later than the
 *      mint and is the question that decides whether the import can commit.
 *
 * The `Adapter` in a renderer holds one of these; the host core exposes it as
 * `HostCore.mintModelId` / `HostCore.mintProfileId` so the app layer does not mint ids of its own.
 */
export function createIdMinter(options: IdMinterOptions = {}): IdMinter {
  const random = options.random ?? randomToken
  const issued = new Set<string>()

  const mint = (prefix: string): string => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const id = `${prefix}${random()}`
      if (issued.has(id))
        continue
      issued.add(id)
      return id
    }
    // A random source that repeats sixteen times in a row is not a random source. Failing loudly beats
    // handing out a duplicate identity, which is unrecoverable once it is referenced.
    throw new Error('Failed to mint a unique host id: the random source produced repeated values')
  }

  return {
    mintModelId: () => mint(PREFIXES.model),
    mintProfileId: () => mint(PREFIXES.profile),
    issued,
  }
}
