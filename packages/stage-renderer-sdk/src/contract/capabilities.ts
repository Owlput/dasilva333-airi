/**
 * Capability discovery, addressing and mapping.
 *
 * Owner split:
 *   - the **renderer** discovers capabilities, names them and owns the resulting record —
 *     labels, the usable/favourite toggles, idle-cycle selection and every ACT mapping —
 *     because it is the only side that can parse or introspect the asset, and the only side
 *     that can render the UI for how capabilities combine with each other;
 *   - **AIRI** keeps one projection of it, read-only: the vocabulary snapshot below, which it
 *     needs to build prompts while no renderer is mounted, plus the card-level profile
 *     reference (`HostModelProfileRecord`).
 */

export enum ModelCapabilityKind {
  /**
   * One expression unit, in the format's own vocabulary.
   *
   * What backs it — a blend shape, a vertex morph, a parameter preset, a compiled clip — is the
   * driver's business, and so is resolving its own token onto it. One unit is one descriptor:
   * there is deliberately no second kind for the same unit under a geometry name, because that
   * asks a driver to enumerate it twice while one cue addresses all of them.
   */
  EXPRESSION = 'expression',
  /** Playable motion/animation. */
  MOTION = 'motion',
  /** A defined alternative style of the same outfit. e.g. difference in color and accessories. */
  OUTFIT_STYLE = 'outfitStyle',
  /** A defined alternative outfit. e.g. a shirt instead of a coat. */
  OUTFIT_GROUP = 'outfitGroup',
  /** Selectable models shipped in one package. */
  ALT_MODEL = 'altModel',
  /** Raw numeric parameter a renderer can drive. */
  PARAMETER = 'parameter',
  /**
   * Addressable mesh or material.
   *
   * Inventory the renderer's own wardrobe UI addresses; AIRI toggles appearance through a
   * `ProfileCue`, so no cue names one of these.
   */
  MESH = 'mesh',
  /** Visual effect family. */
  VFX = 'vfx',
  /**
   * A place the renderer can put its camera on (`ViewCue.pointOfInterestId`), enumerated at
   * runtime by `ModelProvider.modelCapabilities()`.
   *
   * Deliberately NOT part of `CapabilityVocabularySnapshot`: that snapshot is the text AIRI
   * injects into prompts, and a camera target is not a token family (`ActTokenKind`), so a
   * point of interest never belongs in a prompt.
   *
   * A renderer that declares the `'view'` cue MUST NOT declare
   * `capabilityDiscovery: CapabilityDiscoveryMode.NONE`: this is the only way a camera target is
   * ever named, so the two contradict each other.
   */
  POINT_OF_INTEREST = 'pointOfInterest',
}

/**
 * One renderer-native addressable thing.
 *
 * `key` is opaque to AIRI but MUST stay stable across sessions: the renderer's own records —
 * labels, toggles, ACT mappings, saved profiles — point at it, and AIRI replays it as the token,
 * so renaming one orphans both. `label` and `group` live in that same record, which is why what
 * the user renamed a capability to is not what a cue addresses it by.
 */
export interface ModelCapabilityDescriptor {
  key: string
  kind: ModelCapabilityKind
  /** Suggested human label; the renderer's own UI owns the stored value. */
  label?: string
  /** Optional grouping (motion group, outfit family, parameter set). */
  group?: string[]
  /** Optional extra facts (duration, loopable, requires setup). Opaque to AIRI. */
  meta?: Record<string, unknown>
}

/**
 * ACT token families AIRI's marker parser resolves.
 *
 * The token *vocabulary* is the renderer's and is known only at runtime
 * (`CapabilityVocabularySnapshot`); these three families are the compile-time half, and
 * `stage-ui/src/constants/emotions.ts` declares the same three values.
 */
export enum ActTokenKind {
  EMOTION = 'emotion',
  MOTION = 'motion',
  VFX = 'vfx',
}

export interface CapabilityVocabularyItem {
  /**
   * Renderer-native key, exactly as it must appear inside the token.
   *
   * A driver whose token differs from its own native name keeps that alias table itself, on its
   * side of the boundary: AIRI stores and replays the token, never the name behind it.
   */
  key: string
  /** Which ACT token family may carry this key. */
  tokenKind: ActTokenKind
  /** Human-facing name; the renderer's own UI owns it. */
  label: string
}

/**
 * The one capability projection AIRI reads.
 *
 * The renderer writes it into its own per-model snapshot (`persistence.ts`); AIRI only reads
 * it, because prompt building happens with no renderer mounted: chat and the autonomous
 * Director run with the stage window closed, and a renderer like VRM only knows its
 * expressions after the model is loaded.
 *
 * The list MUST stay stable for a given `(model, selection)`: AIRI injects it into prompts,
 * and prompt-prefix caching is destroyed by a vocabulary that changes every turn. Anything
 * volatile belongs in a separate, tail-placed section rather than here.
 */
export interface CapabilityVocabularySnapshot {
  items: CapabilityVocabularyItem[]
  /** Renderer-authored usage notes to carry alongside the list. */
  instructions?: string
  updatedAt: number
}
