# Unified Sticker Architecture: Card Directives, Prefix-Cache Alignment & Modality Routing

> **Living Technical Specification & Architecture Refinement**:
> * **Tracking Issue / Base Reference**: Ported from upstream PR [#2714](https://github.com/moeru-ai/airi/pull/2714) (`moeru-ai/airi` / commit `7187df8caf`), heavily revised to eliminate upstream prefix-cache destruction and unhooked mockups.
> * **Target Workspace**: `dasilva333/airi`
> * **Governing Skills**: [`airi-acting-cue-act-tokens`](../.agents/skills/airi-acting-cue-act-tokens/SKILL.md), [`airi-prefix-cache-alignment`](../.agents/skills/airi-prefix-cache-alignment/SKILL.md), [`airi-card-schema`](../.agents/skills/airi-card-schema/SKILL.md), [`airi-desktop-chatbox`](../.agents/skills/airi-desktop-chatbox/SKILL.md)
> * **Related Catalogs**: [`docs/data-catalog.md`](./data-catalog.md)

---

## 1. Executive Summary & Problem Statement

Upstream PR [#2714](https://github.com/moeru-ai/airi/pull/2714) contributed a device-local emotion sticker library and in-chat rendering (`assistant-item.vue`). However, its prompt integration suffers from a critical anti-pattern:

### The Upstream Anti-Pattern: Deterministic Prompt Invalidation
Upstream implemented reaction frequency as a **runtime per-turn dice roll**:
```typescript
// Upstream anti-pattern in chat-orchestrator-runtime.ts:
const stickers = options.stickers // randomized per turn based on frequency %
const stickerPrompt = stickers?.length ? generateCatalogPrompt(stickers) : ''
systemMessage.content.push({ type: 'text', text: stickerPrompt })
```
Whenever the frequency dice roll toggles between eligible and ineligible across conversational turns (e.g., at 50% frequency), the system prompt bytes mutate dynamically. Under modern providers (DeepSeek, Anthropic, Gemini, OpenRouter), **mutating the root system prompt completely invalidates the KV prefix cache**, forcing the user to pay 100% full input token costs on every turn.

Furthermore, upstream made stickers global to the client settings rather than scoped to character identity. In AIRI, character personas own their expressive vocabulary.

### The Unified Solution
1. **Persona Ownership via `AiriExtension.acting.stickerDirectives`**:
   Stickers are treated identically to **ACT Directives** (`modelExpressionPrompt`), **Vocal Directives** (`speechExpressionPrompt`), and **Speech Mannerisms** (`speechMannerismPrompt`). They are authored per character card in the **Acting Tab** and compiled into the **frozen, static system prompt prefix** once.
2. **Semantic Restraint vs. Random Toggles**:
   Frequency and emotional appropriateness are taught to the model semantically via prompt directives (e.g., *"Use reaction stickers sparingly when playful or lighthearted emotional punctuation naturally fits the dialogue; avoid them during serious, reflective, or technical topics"*), rather than mutating the system prompt per turn.
3. **Multi-Modal Token Routing (`<|STICKER ...|>`)**:
   - **Phase 1 (Inline Reaction Slices)**: Canonical `<|STICKER id|>` streams into chat bubbles as a rich visual reaction badge.
   - **Phase 2 (Desktop Widget Slappers & Lightweight MPA Engine)**: Expressive parameters allow directing stickers to the desktop workspace as ephemeral, crooked post-it stamps:
     - `<|STICKER id|>`: Implicit inline chat slice (default `surface="chat"`).
     - `<|STICKER id surface="widget" weight="0.8"|>`: Explicit desktop screen sticker widget with dynamic scale and lifespan.
     - `<|STICKER id surface="both" weight="0.5"|>`: Dual manifest (inline chat badge + desktop screen stamp).
4. **Zero-Tax MPA Execution (`sticker.html`)**:
   Instead of paying the heavy ~80 MB SPA boot tax (Vue runtime, Pinia, Vue Router, UnoCSS, Eventa) just to display a single floating PNG, desktop stickers mount through a dedicated, zero-dependency Electron MPA entry point (`sticker.html`) featuring interactive "tap to peel off" physics and weight-scaled lifespans.

### The "Zero Tool Calls" Invariant: Why Streaming Tokens Defeat Native Function Calling

A frequent architectural temptation in agentic systems is wrapping every external manifestation into a native LLM tool call (e.g., a function call like `spawn_sticker(id, surface, weight)`). AIRI strictly rejects and excises native tool calling for character reaction stickers in favor of inline streaming tokens (`<|STICKER id ... |>`).

This architectural invariant was solidified by live multi-actor empirical testing (e.g., across Madoka, Arona, and Kurisu in "The Clockwork Roast & Haven Cafe"), proving 4 decisive operational advantages:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                 NATIVE FUNCTION CALL vs. STREAMING INLINE TOKEN                         │
├────────────────────────────────┬────────────────────────────────────────────────────────┤
│ Native Tool Call (Broken UX)   │ Streaming Inline Token (AIRI Paradigm)                 │
├────────────────────────────────┼────────────────────────────────────────────────────────┤
│ • Batch-fired upfront in turn  │ • Streamed in exact temporal lockstep with speech     │
│ • Spams UI before dialogue     │ • Slaps onto screen as character utters the line       │
│ • No voice / sentence audio sync│ • Precise Sentence-Sync audio playback millisecond    │
│ • Global assistant level only  │ • Scoped cleanly inside <|ACTOR:...|> turns            │
│ • Incurs KV cache schema bloat │ • 100% frozen prefix cache reuse                       │
│ • Hallucinates tool/text drift │ • Single unambiguous acting token pipeline            │
└────────────────────────────────┴────────────────────────────────────────────────────────┘
```

#### 1. Temporal Lockstep & Conversational Pacing (Elimination of Upfront Batching)
In standard LLM tool calling protocols (OpenAI function calling, Anthropic tool use, Gemini Live tools), tool invocations are emitted as structured frames prior to or distinct from the assistant's prose stream (`toolCallQueue`).
- **Failure Mode with Tool Calls**: When a character's turn is meant to contain multiple expressive beats or when multiple characters converse in an ensemble, tool calls execute in an upfront batch before any speech text streams. The UI gets instantly spammed with 3–4 sticker stamps simultaneously before a single word is rendered. The narrative suspense, dramatic timing, and comedic beat are destroyed.
- **The Inline Token Solution**: The `<|STICKER id|>` token is embedded directly in the text stream. It is received and executed at the exact temporal moment in the generation loop when the character produces that conversational thought.

#### 2. Sentence-Sync Audio & Avatar Gesture Synchronization
AIRI's audio runtime (`useSpeechCaptionPlayer`, `airi-speech-runtime`, `airi-acting-cue-act-tokens`) synchronizes TTS voice generation with Live2D/VRM speech bubbles and avatar gestures.
- Because `<|STICKER id|>` is colocated inside the character's verbal sentence, the sticker slaps onto the screen at the exact millisecond when the character utters that phrase in voice audio.
- Native tool calls have zero audio temporal grounding; they trigger before audio synthesis even begins.

#### 3. True Multi-Actor Attribution & Spatial Boundaries
In multi-character cards (ensembles or cafe/office scenes), multiple personas interact within a single assistant generation pass, delimited by `<|ACTOR:{actorId}|>` tokens.
- Native tool calls exist at the global assistant level with no inherent actor attribution unless awkward metadata parameters are manually plumbed through schemas.
- Inline tokens naturally live within each actor's speech block:
  ```text
  <|ACTOR:actor_kaname_madoka|>
  ...And you still never drank the tea.
  <|STICKER id="madoka-gentle-worry" surface="chat" pos="bottomLeft"|>

  <|ACTOR:actor_arona_blue_archive|>
  Then the fallback earned its keep, Sensei!
  <|STICKER id="arona-sparkle-pride" surface="both" weight="0.8" pos="topRight"|>
  ```
  Each character independently owns their emotional cues, physical placement quadrant, and delivery timing without cross-actor contamination.

#### 4. Prefix Cache Preservation & Zero-Hallucination Discipline
- Registering a native `spawn_sticker` tool requires serializing tool schemas and parameters into every API dispatch payload, bloating token count and risking KV cache invalidation across turns.
- Giving the LLM two distinct pathways (a tool call *and* inline markers) creates prompt competition, causing models to alternate unpredictably between tool calls and text, hallucinate non-existent tool signatures, or emit incomplete JSON blocks.
- By permanently excising `spawn_sticker` and treating stickers as first-class acting tokens, the directives compile once into the frozen system prompt prefix (`buildCharacterSystemPrompt`), achieving 100% prefix cache hits with zero runtime tool calling overhead.

---


## 2. Data Contracts & Schema Architecture

### 2.1 Extension Schema: `AiriExtension.acting` & `AiriExtension.stickers`
In `packages/stage-ui/src/types/card.schema.ts` and `docs/data-catalog.md`:

```typescript
export interface CardCustomSticker {
  id: string
  label: string
  description: string
  emotions: string[]
  createdAt: number
  /**
   * Optional base64 data URL populated during card export for full offline portability.
   */
  dataUrl?: string
}

export interface ActingConfig {
  modelExpressionPrompt: string
  speechExpressionPrompt: string
  speechMannerismPrompt: string
  /**
   * Character-scoped sticker prompt directives and allowed catalog.
   * Injected into the frozen system prompt prefix alongside modelExpressionPrompt.
   */
  stickerDirectivesPrompt?: string
  /**
   * Enabled sticker IDs from the registered library for this character.
   */
  activeStickerIds?: string[]
  /**
   * Toggle: Allow character to spawn stickers as desktop stage widgets/slappers.
   */
  stickerWidgetsEnabled?: boolean
  idleAnimations?: string[]
  pacing?: AiriPacing
  cueAllowlist?: CharacterCueAllowlist
  autoCuesEnabled?: boolean
  autoCueExpressions?: boolean
  autoCueMotions?: boolean
}
```

On `AiriCardExtension` (`card.extensions.airi`):
```typescript
export interface AiriCardExtension {
  // ...
  acting?: ActingConfig
  /**
   * Character-owned custom sticker manifest dictionary keyed by token slug id.
   */
  stickers?: Record<string, CardCustomSticker>
}
```

### 2.2 Persistence Layer Architecture: The "Lazy B" Strategy

To balance lightweight card sizes, fast runtime performance, and card portability:

1. **Runtime Execution (Local-First IndexedDB Blobs)**:
   - When a user uploads a sticker PNG/WebP, the binary `File`/`Blob` is stored directly in `localforage` under key `sticker-data-${id}`.
   - Bypasses Vue reactive proxies and `JSON.stringify` to guarantee binary safety (per `airi-binary-safety`).
   - `getStickerUrl(id)` in `useStickersStore` resolves URLs:
     1. Static built-ins (`packages/stage-ui/src/assets/stickers/`).
     2. `localforage.getItem<Blob>('sticker-data-${id}')` -> `URL.createObjectURL(blob)` (cached in-memory).
2. **Card Manifest Record**:
   - The card stores metadata (ID slug, display label, prompt description, emotions) in `card.extensions.airi.stickers[id]`.
   - The card does **not** store bloated base64 strings during regular local editing, keeping memory and database queries fast.
3. **Card Export / Import Portability**:
   - **Export (`use-card-export.ts`)**: Reads blobs for all `card.extensions.airi.stickers` from `localforage`, converts them to base64 Data URLs on the exported payload, ensuring exported cards carry all custom reaction stickers.
   - **Import (`CardImportWizard.vue` / import handler)**: Decodes any embedded sticker `dataUrl`s and writes them into `localforage.setItem('sticker-data-${id}', blob)`.

### 2.3 System Prompt Assembly (`buildCharacterSystemPrompt`)
In `packages/stage-ui/src/stores/modules/airi-card.ts`:
```typescript
const acting = card.extensions?.airi?.acting
if (acting) {
  if (acting.modelExpressionPrompt?.trim())
    components.push(acting.modelExpressionPrompt)
  if (acting.speechExpressionPrompt?.trim())
    components.push(acting.speechExpressionPrompt)
  if (acting.speechMannerismPrompt?.trim())
    components.push(acting.speechMannerismPrompt)
  // Static, frozen sticker directives:
  if (acting.stickerDirectivesPrompt?.trim())
    components.push(acting.stickerDirectivesPrompt)
}
```
**Prefix Cache Invariant**: Because `buildCharacterSystemPrompt` is constructed once when a card/session initializes and remains static during chat execution, the entire prompt block benefits from 100% KV cache hits across turns.

---

## 3. Token Grammar & Parser Specification

### 3.1 Token Shapes & Parameter Grammar
The lexer in `packages/stage-ui/src/composables/llm-marker-parser.ts` and marker extractor in `packages/stage-ui/src/stores/chat.ts` support two syntax forms using space-delimited `key=value` attributes:

1. **Short Implicit Form (Baseline)**:
   ```text
   <|STICKER airi-happy|>
   ```
   Renders as an inline reaction slice in the assistant chat bubble (implicit default: `surface="chat"`).

2. **Attribute Parametric Form (Multi-Modal & Desktop Routing)**:
   ```text
   <|STICKER id="airi-celebrate" surface="widget" weight="0.8" pos="topRight"|>
   <|STICKER lupin-warm-smile surface="both" weight="0.5" pos="bottomLeft"|>
   <|STICKER airi-sad surface="widget" weight="0.2"|>
   ```
   - **`id`** *(first positional argument or `id="..."`)*: Unique identifier of the sticker asset from the catalog (e.g. `airi-happy`, `lupin-warm-smile`).
   - **`surface`** *(optional, default: `"chat"`)*: Target manifestation surface:
     - `chat` (or `inline`): Appended exclusively as a chat bubble slice.
     - `widget`: Spawns onto the desktop as a floating, crooked sticker window.
     - `both`: Emits in both the chat bubble and spawns as a desktop sticker window.
   - **`weight`** *(optional, float `0.0` to `1.0`)*: Dynamic presence scalar affecting both **Size** and **Duration** (see §4 for weight math). If omitted, picks a playful randomized duration between 90s and 240s with standard 1.0x scale.
   - **`pos`** *(optional, default: `"random"`)*: Preferred desktop viewport placement quadrant (`topLeft`, `topRight`, `bottomLeft`, `bottomRight`, `random`).

### 3.2 Parser, Lexer & Boundary Gates
To protect TTS, captions, and history replay, the token pipeline enforces six gates:

1. **Bare-`>` Whitelist Gate**:
   `findLegacyCloseTagIndex` in `llm-marker-parser.ts` includes `<|STICKER` in its whitelist so models closing tags with bare `>` instead of `|>` do not leak into literal text.
2. **Audio / Speech Stripping Gate**:
   `stripMarkers` in `response-categoriser.ts` strips `<|STICKER...|>` before categorizing text into speech. TTS engines (Kokoro, ElevenLabs, OpenAI) never speak sticker tokens.
3. **Caption Isolation Gate**:
   Floating subtitle overlays (`useSpeechCaptionPlayer.ts`, `airi-caption-overlay`) exclude sticker tokens completely.
4. **Reasoning Separation Gate**:
   If an LLM hallucinates or drafts a sticker token inside deep thought tags (`<think> ... </think>`), the marker parser ignores it. Stickers only trigger when emitted in visible speech text.
5. **Single-Sticker Limit Per Turn**:
   Guards prevent repetitive spam by allowing at most one sticker manifestation per assistant turn unless explicitly instructed otherwise.
6. **Dual Storage Contract**:
   - `content`: Display prose with all sticker markers stripped.
   - `rawContent`: Ground-truth inference record preserving `<|STICKER ...|>` so replaying turns into inference context prevents model forgetfulness.
7. **Zero Tool Calls Invariant (No Upfront Batch Spam)**:
   Native tool calling (`spawn_sticker`) is strictly prohibited and excised. Stickers are purely non-tool streaming acting tokens. This ensures reaction visual badges slap into view sequentially in exact lockstep with character dialogue and vocal cues, rather than spamming the interface in an upfront batch before text streaming begins.

---

## 4. Desktop Sticker Engine: Dedicated MPA Architecture (`sticker.html`)

### 4.1 The SPA Window Tax vs. The Lightweight MPA Solution
In a unified desktop Electron architecture, opening a secondary window via the main SPA route (`index.html#/widgets?id=...`) forces Chromium to load:
- The entire Vue 3 reactivity engine and Pinia store root.
- The Vue Router history stack.
- The global UnoCSS stylesheet and i18n bundle.
- Eventa IPC contexts and background service connections.

**The Tax**: Each SPA-driven sticker window consumes ~60–80 MB of RAM and takes ~300–500ms to paint. Spawning 3 stickers costs ~200 MB of system memory.

**The MPA Solution**: Following the precedent set by `splash.html`, stickers are decoupled into a dedicated, zero-dependency Multi-Page Application (MPA) entry point: `apps/stage-tamagotchi/src/renderer/sticker.html`.
- **Footprint**: < 2 KB of pure static HTML, CSS, and vanilla JS.
- **Memory**: ~12–15 MB per Chromium webContents (~80% reduction).
- **Startup Latency**: < 30ms (instantaneous visual pop).
- **Build Entry in `electron.vite.config.ts`**:
  ```typescript
  rollupOptions: {
    input: {
      'main': resolve(join(import.meta.dirname, 'src', 'renderer', 'index.html')),
      'beat-sync': resolve(join(import.meta.dirname, 'src', 'renderer', 'beat-sync.html')),
      'splash': resolve(join(import.meta.dirname, 'src', 'renderer', 'splash.html')),
      'sticker': resolve(join(import.meta.dirname, 'src', 'renderer', 'sticker.html')),
    },
  }
  ```

### 4.2 Physical Vinyl & "Tap to Peel" Interaction
The sticker window is styled to look and feel like an authentic physical vinyl decal or crooked post-it note slapped on the monitor:
1. **Crooked Angle**: Randomized rotation of $\pm (3^\circ \text{ to } 6^\circ)$ generated on mount:
   ```css
   transform: rotate(var(--tilt, -3.5deg));
   filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.22));
   ```
2. **Interactive "Tap to Peel Off"**:
   - The sticker is interactive (`-webkit-app-region: no-drag`, `cursor: pointer`).
   - Clicking on the sticker triggers a tactile paper-peeling CSS animation:
     ```css
     @keyframes peel-off {
       0% { transform: scale(1) rotate(var(--tilt)); opacity: 1; }
       35% { transform: scale(1.04) rotate(calc(var(--tilt) - 4deg)) translateY(-4px); }
       100% { transform: scale(0.8) rotate(calc(var(--tilt) + 14deg)) translateY(-30px); opacity: 0; }
     }
     ```
   - On animation completion (~250ms), vanilla JS calls `window.close()` to immediately free the webContents.

### 4.3 Weight Dynamics: Unified Scale & Ephemeral Duration
Instead of exposing raw millisecond TTL parameters to the LLM, the model expresses presence via a continuous `weight` parameter: $W \in [0.0, 1.0]$.
Weight governs both physical dimension and on-screen persistence:

| Weight ($W$) | Emotional Intent | Visual Size | Lifespan / Ephemeral TTL |
| :--- | :--- | :--- | :--- |
| **`0.1 – 0.3`** | Playful stamp, subtle punctuation, fleeting wink | Compact (160px – 190px) | Short (60s – 90s) |
| **`0.4 – 0.7`** | Standard reaction, balanced mood expression | Normal (200px – 240px) | Medium (120s – 180s) |
| **`0.8 – 1.0`** | Major statement, emphatic celebration, important memo | Large (260px – 300px) | Long (240s – 300s) |
| **Omitted** | Default character speech reaction | Standard (220px) | Randomized sweet spot ($90\text{s} \dots 240\text{s}$) |

- **Auto-Peel on Timeout**: When the weight-derived TTL expires, the sticker automatically triggers the peel-off animation and destroys itself, ensuring desktop workspace cleanliness without user maintenance.

### 4.4 Electron Window Configuration & Placement
In `apps/stage-tamagotchi/src/main/windows/widgets/index.ts`:
- **Window Specs**: Frameless, transparent, `type: 'panel'`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`, `hasShadow: false`.
- **Placement**: Spawned along the perimeter/margins of the primary display's workArea (top/bottom/side bands) avoiding the active center workspace.

---

## 5. UI Authoring: Acting Tab (`ActingSubTabStickers.vue`)

The Stickers sub-tab in `CardCreationTabActing.vue` is refactored from unhooked mockups to a functional prompt-authoring workstation:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 🎨 Reaction Stickers Directives & Library                              │
│ Configure character reaction stickers, inline cadence, and screen     │
│ widget slappers.                                                       │
├────────────────────────────────────────────────────────────────────────┤
│ [ ] Include Stickers as Desktop Screen Slappers                        │
│     Allows the character to slap stickers onto your desktop workspace  │
│     using <|STICKER id surface="widget" weight="..." pos="..."|>       │
├────────────────────────────────────────────────────────────────────────┤
│ Sticker Directives & Instructions                                      │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ ## Reaction Sticker Directives                                     │ │
│ │ You have access to expressive chibi stickers. Use at most one per  │ │
│ │ reply when natural emotional punctuation fits your dialogue.       │ │
│ │ Avoid stickers in serious or technical discussions.                │ │
│ │ Available catalog:                                                 │ │
│ │ - <|STICKER airi-happy|>: Cheerful smile, laughter                 │ │
│ │ - <|STICKER airi-sad|>: Crying, downcast                           │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ [ 🪄 Optimize with AI ] [ 🔄 Sync Directives from Catalog ]            │
├────────────────────────────────────────────────────────────────────────┤
│ Character Sticker Catalog (12 built-in)                                │
│ Click any sticker below to insert its token into your directives:      │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│ │  [Chibi Img] │  │  [Chibi Img] │  │  [Chibi Img] │  │  [Chibi Img] │ │
│ │  airi-happy  │  │   airi-sad   │  │ airi-confused│  │ airi-celebrate││
│ │  [ + Insert] │  │  [ + Insert] │  │  [ + Insert] │  │  [ + Insert] │ │
│ └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### UI Interactions:
1. **Sync Directives from Catalog**:
   Automatically formats and populates `stickerDirectivesPrompt` using the active character catalog (both built-in and character-owned custom stickers) and appropriate tone guidelines.
2. **Add Custom Sticker (`CardStickerAddModal.vue`)**:
   - Allows uploading local PNG/WebP files.
   - Enforces unique semantic slug token IDs (e.g. `columbina-scheming`).
   - Captures label, description, and emotions for prompt synthesis.
   - Saves binary directly to `localforage` and metadata to `card.extensions.airi.stickers`.
3. **AI Sparkle Integration**:
   Uses `@sparkle-click="emit('sparkle-click', 'actingStickerDirectives')"` to allow LLM refinement of sticker behavior and personality tone.

---

## 6. Phased Roadmap

| Phase | Scope | Deliverables | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Prefix-Safe Core & Card Schema** | 1. Add `stickerDirectivesPrompt` & `activeStickerIds` to `card.schema.ts` and `AiriExtension`.<br>2. Wire `stickerDirectivesPrompt` into `buildCharacterSystemPrompt` (frozen prefix).<br>3. Overhaul `ActingSubTabStickers.vue` with prompt textarea, sync button, and catalog insertion pills.<br>4. Preserve in-chat `<ChatSticker />` slice rendering in `assistant-item.vue`. | **Shipped** |
| **Phase 1.5** | **Custom Sticker Upload ("Lazy B" Persistence)** | 1. Add `CardCustomSticker` schema to `extensions.airi.stickers`.<br>2. Build `CardStickerAddModal.vue` with image dropzone, slug validation, and metadata inputs.<br>3. Store binary in `localforage.setItem('sticker-data-${id}', file)`.<br>4. Integrate custom stickers into merged catalog view and "Sync from Catalog" prompt builder.<br>5. Support card export packaging and import extraction for portable sticker sharing. | **In Progress** |
| **Phase 2** | **Lightweight Desktop Sticker Engine (MPA & Physical Peel-off)** | 1. Register `sticker.html` in `electron.vite.config.ts`.<br>2. Build zero-framework `sticker.html` with crooked tilt, vinyl shadow, and `@keyframes peel-off` click interaction.<br>3. Extend token parser to support space-delimited parameters (`<|STICKER id surface="..." weight="..." pos="..."|>`).<br>4. Implement weight translation matrix ($W \mapsto \text{Size} \times \text{Duration}$).<br>5. Wire `apps/stage-tamagotchi/src/main/windows/widgets/index.ts` to dispatch `sticker.html` with random screen edge placement. | Planned |
| **Phase 3** | **Sticker Forge (Generative AI Synthesis)** | 1. Connect Artistry / Pollinations / ComfyUI pipeline to generate sticker variations on the fly.<br>2. Prompt recipe builder (LINE sticker / chibi die-cut vector styling). | Planned |

