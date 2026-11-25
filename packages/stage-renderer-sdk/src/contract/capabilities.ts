/**
 * Capability discovery, addressing and mapping.
 *
 * Owner split:
 *   - the **renderer** discovers capabilities, names them and owns the resulting record —
 *     labels, the usable/favourite toggles, idle-cycle selection and every ACT mapping —
 *     because it is the only side that can parse or introspect the asset, and the only side
 *     that can render the UI for how capabilities combine with each other;
 *   - **AIRI** asks, and keeps no copy: a capability list is produced on demand by
 *     `ModelProvider.modelCapabilities()`, and the token list a card editor needs comes from
 *     `ModelProvider.vocabulary()`. There is no projection AIRI stores, because the driver may
 *     change what a model can do without telling anyone (a reloaded asset, a downgraded device, a
 *     repaired package) and a stored copy would then describe a model that no longer exists.
 */

export enum ModelCapabilityKind {
  /**
   * One expression unit, in the format's own vocabulary.
   *
   * What backs it — a blend shape, a vertex morph, a parameter preset, a compiled clip — is the
   * driver's business, and so is resolving its own token onto it. One unit is one descriptor.
   */
  EXPRESSION = 'expression',
  /** Playable motion/animation. */
  MOTION = 'motion',
  /**
   * A defined set of parameters and settings of a model,
   * including outfit, alternate model, raw parameters, etc.
   */
  PROFILE = 'profile',
  /** Raw numeric parameter a renderer can drive. */
  PARAMETER = 'parameter',
  /**
   * One visual effect family, addressed by `EffectCue.effect`.
   *
   * Renamed from `vfx` at contract `0.1` so the descriptor kind and the cue that names it read the
   * same: an effect family is what a renderer *offers*, and the cue is how AIRI triggers it.
   * (`ActTokenKind.VFX` keeps its name: that is a token family inside prompt text, which is a
   * different vocabulary.)
   */
  EFFECT = 'effect',
  /**
   * A place the renderer can put its camera on (`ViewCue.pointOfInterestId`), enumerated at
   * runtime by `ModelProvider.modelCapabilities()`. Also the target of `GazeCue` with
   * `mode: GazeMode.POINT_OF_INTEREST`.
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
 * (`CapabilityVocabulary`); these three families are the compile-time half, and
 * `stage-ui/src/constants/emotions.ts` declares the same three values.
 *
 * `VFX` keeps this spelling deliberately: it names the family that appears inside prompt text
 * (`ACT vfx(...)`), which is character content written years ago, whereas the descriptor a
 * renderer lists and the cue AIRI sends are `ModelCapabilityKind.EFFECT` / `EffectCue`. Renaming
 * this one would invalidate every card that already contains a token.
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
 * The token list a driver accepts right now, as `ModelProvider.vocabulary()` reports it.
 *
 * A **live answer, not a projection AIRI keeps**: the card editor and the rehearsal room need to
 * know which tokens a model understands, and only the driver can say. Nothing writes one, and
 * nothing is restored from one.
 *
 * The list MUST stay stable for a given `(model, selection)`: AIRI injects the tokens into prompts
 * as instructions, and prompt-prefix caching is destroyed by a vocabulary that changes every turn.
 * Anything volatile belongs in a separate, tail-placed field rather than here.
 *
 * This is **not** the token list that travels with a prompt publication: that one is the plain
 * `string[]` on `ModelPromptPublication` (`host-services.ts`), bound to one text by one version.
 * This is the live enumeration a UI offers choices from.
 */
export interface CapabilityVocabulary {
  items: CapabilityVocabularyItem[]
  /** Renderer-authored usage notes to carry alongside the list. */
  instructions?: string
}
