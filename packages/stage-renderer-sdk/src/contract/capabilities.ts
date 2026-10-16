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

export type ModelCapabilityKind
  /** Blend-shape / expression-preset-like unit (VRM expressions, Live2D exp3). */
  = | 'expression'
    /** Geometry-level morph target (MMD morphs, VRM blend shapes). */
    | 'morph'
    /** Playable motion/animation. */
    | 'motion'
    /** A defined alternative style of the same outfit. e.g. difference in color and accessories. */
    | 'outfitStyle'
    /** A defined alternative outfit. e.g. a shirt instead of a coat. */
    | 'outfitGroup'
    /** Selectable models shipped in one package. */
    | 'altModel'
    /** Raw numeric parameter a renderer can drive. */
    | 'parameter'
    /** Addressable mesh or material, used by the wardrobe editor. */
    | 'mesh'
    /** Visual effect family. */
    | 'vfx'
    /**
     * A place the renderer can put its camera on (`ViewCue.pointOfInterestId`), enumerated at
     * runtime by `ModelProvider.modelCapabilities()`.
     *
     * Deliberately NOT part of `CapabilityVocabularySnapshot`: that snapshot is the text AIRI
     * injects into prompts, and a camera target is not a token family (`ActTokenKind`), so a
     * point of interest never belongs in a prompt.
     *
     * A renderer that declares the `'view'` cue MUST NOT declare `capabilityDiscovery: 'none'`:
     * this is the only way a camera target is ever named, so the two contradict each other.
     */
    | 'pointOfInterest'

/**
 * One renderer-native addressable thing.
 *
 * `key` is opaque to AIRI but MUST stay stable across sessions, because AIRI persists mappings
 * that point at it. `label` and `group` are contained in the renderer's own record, so what
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
export type ActTokenKind = 'emotion' | 'motion' | 'vfx'

export interface CapabilityVocabularyItem {
  /** Renderer-native key, exactly as it must appear inside the token. */
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
