/**
 * Capability discovery, addressing and mapping.
 *
 * Owner split, and this is the point of the file:
 *   - the **renderer** discovers capabilities, names them and owns the resulting
 *     record — labels, the usable/favourite toggles, idle-cycle selection and
 *     every ACT mapping — because it is the only side that can parse or
 *     introspect the asset, and the only side that can render the UI for how
 *     capabilities combine with each other;
 *   - **AIRI** keeps one projection of it, read-only: the vocabulary snapshot
 *     below, which it needs to build prompts while no renderer is mounted, plus
 *     the card-level preset reference.
 *
 * Purpose: today both sides compute this independently and disagree. The host
 * parses Live2D zips and Spine skeletons with hardcoded candidate tables and
 * truncates MMD morphs to 30, while each renderer builds the authoritative list
 * from its loaded runtime (Spine reads real skins/animations from skeleton data,
 * VRM reads the expression manager). The stored list and the runtime list then
 * diverge, which is why the customizer has to reconcile them at display time.
 * Under this contract there is only one list, and the renderer owns it.
 */
export type RendererCapabilityKind
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
    /** Selectable models shipped in one package (Spine). */
    | 'altModel'
    /** Raw numeric parameter a renderer can drive (Live2D parameters). */
    | 'parameter'
    /** Addressable mesh or material, used by the wardrobe editor. */
    | 'mesh'
    /** Visual effect family. */
    | 'vfx'

/**
 * One renderer-native addressable thing.
 *
 * `key` is opaque to AIRI but must stay stable across sessions, because AIRI
 * persists mappings that point at it. Today Live2D stores full zip paths as keys
 * while the runtime matches on basenames, which is exactly the stability problem
 * this contract has to prevent.
 */
export interface RendererCapabilityDescriptor {
  key: string
  kind: RendererCapabilityKind
  /** Suggested human label; the renderer's own UI owns the stored value. */
  label?: string
  /** Optional grouping (motion group, outfit family, parameter set). */
  group?: string[]
  /** Optional extra facts (duration, loopable, requires setup). Opaque to AIRI. */
  meta?: Record<string, unknown>
}

/**
 * ACT token families AIRI's marker parser resolves today.
 *
 * `stage-ui/src/constants/emotions.ts` already declares the same three values,
 * and the three `insert-token` sites in `ModelCustomizer.vue` emit exactly these
 * families.
 */
export type ActTokenKind = 'emotion' | 'motion' | 'vfx'

export interface RendererVocabularyItem {
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
 * Purpose: prompt building happens with no renderer mounted. Chat and the
 * autonomous Director run with the stage window closed, and a renderer like VRM
 * only knows its expressions after the model is loaded, so AIRI cannot ask a
 * live renderer for names at that moment. The renderer writes this into its own
 * per-model snapshot (`persistence.ts`) and AIRI only reads it.
 *
 * The list must stay stable for a given `(model, selection)`: AIRI injects it
 * into prompts, and prompt-prefix caching is destroyed by a vocabulary that
 * changes every turn. Anything volatile belongs in a separate, tail-placed
 * section rather than here.
 */
export interface RendererVocabularySnapshot {
  items: RendererVocabularyItem[]
  /** Renderer-authored usage notes to carry alongside the list. */
  instructions?: string
  updatedAt: number
}
