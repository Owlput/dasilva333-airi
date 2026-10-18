# 🚀 AIRI v0.9.40-stable.20261018 — Release Notes

This release introduces an extraordinary leap in companion expressiveness, cognitive transparency, and workspace ergonomics: debuting **Desktop Screen Sticker Slappers**—allowing companions to slap expressive, animated stickers directly onto your desktop timed to their voice and emotional reactions—alongside **On-Device Anime Background Removal (IS-Net)**, **Dual-Channel Pre-Flight Grounding**, **Guided Auto Suggestions & Unified Director Lite**, a cinematic **Character Card View & Widescreen Scene Gallery**, direct **Character Tavern Community Hub** integration, **Speech Synthesis Markdown/Math Sanitization**, and substantial **Screen Capture IPC Performance Optimizations**.

Companions can now punctuate conversations with playful on-screen stickers, let you create transparent mascot stickers from any artwork using zero-erosion on-device neural segmentation, offer proactive quick-reply suggestions via an in-composer magic wand unified across desktop and web, transparently reveal memory snippets before generation, and discover community character cards directly within onboarding and import menus.

---

## ✨ Key Highlights

### 🌟 Desktop Sticker Slappers & Parametric Reaction Engine
* **Desktop Screen Sticker Slappers**: Companions can now slap cute, animated sticker reactions directly onto your desktop screen in real-time, dynamically coordinated with active speech synthesis and emotional tone.
* **Lightweight Desktop Slapper Window**: Powered by a dedicated, lightweight desktop overlay that renders floating sticker animations with smooth entrance physics, auto-dismiss timers, and speech lifecycle synchronization.
* **Fuzzy Mascot Sticker Matching**: Automatically resolves companion sticker triggers across custom naming conventions, ID prefixes, and format extensions.
* **In-Place Sticker Editing & Re-Keying**: Edit, re-label, and manage your companion's sticker deck directly from the character customizer with instant localforage blob re-keying.

### ✂️ On-Device Anime Background Removal (IS-Net)
* **Zero-Erosion Neural Background Removal**: Create transparent character stickers instantly from any anime illustration or artwork without sending images to external clouds or paying third-party APIs.
* **WebGPU IS-Net Architecture**: Swapped to the specialized `jellybox/isnet-anime` neural model running directly on WebGPU via raw ONNX Runtime Web (`isnet-anime_1024.onnx`), achieving 0% character line erosion (down from 11% on general-purpose models).
* **Interactive Edge Sensitivity & Alpha Compositing**: Fine-tune cutout boundaries with a real-time edge sensitivity slider, calibrated gamma curve, and cached alpha mask re-compositing before saving stickers to your deck.
* **Dedicated Cache Storage Management**: Neural weights cache reliably in Cache Storage (`bg-removal-cache`) with progress reporting and automatic recovery.

### 🧠 Dual-Channel Pre-Flight Grounding & Scalable Semantic Memory
* **Pre-Flight Grounding & WYSIWYG Dispatch**: Transparently inspect the exact memory snippets, Knowledge Graph entities, and sensory context that will be injected into the prompt before the model begins generating a response.
* **Active Amber Grounding Bar**: Added an interactive amber status bar above the chat composer that illuminates whenever Universe Memory RAG retrieval is actively participating in a turn.
* **Single-Owner Embedding Worker & Watermark-Gated Deltas**: Overhauled vector memory indexing to use a single-owner background worker with watermark gates, preventing duplicate computations, thread contention, and UI stutter during extended chats.
* **Overlapping Turn Chunking & Quantized Vector Cache**: Chunks conversation history into overlapping semantic windows with quantized vector caching, drastically improving recall for subtle callbacks and long-term references.
* **One-Click Vector Corpus Rebuild**: Added an explicit "Rebuild Vector Index" tool in Memory Settings to regenerate all semantic embeddings cleanly after migrations or model updates.

### 🪄 Auto Suggestions & Director Lite Magic Wand
* **Interactive Guided Responses**: Companions can now provide contextual quick-reply chips above the message composer, giving you instant prompts to steer the scene, answer queries, or advance roleplay.
* **Unified Across All 3 Chat Surfaces**: The Director Lite magic wand button and proactive suggestion chips are now uniformly supported across Desktop Chatbox, Portrait Web, and Landscape Web (bringing Landscape Web into full parity with the other two).
* **Speech Lifecycle Synchronization**: Suggestion generation coordinates with TTS audio playback and automatically deduplicates options to avoid stale recommendations.

### 🎭 Character Card View Hero Redesign & Widescreen Scene Gallery
* **Cinematic Hero Banner & Dedicated Route Navigation**: Completely redesigned the Character Card inspector with a widescreen cinematic hero banner, dedicated `/cards/:id` route navigation, and rich markdown rendering for backstory and lore.
* **Identity vs. Identifier Separation**: Cleanly decoupled companion display names and personas from internal storage identifiers, allowing companions to be renamed without breaking bindings or model paths.
* **Hero Banner Tagline Sanitization**: Automatically strips raw markdown headings from the card's top hero banner for clean, readable subtitles.
* **Widescreen Scene Gallery**: Overhauled the stage backgrounds gallery into an expansive, responsive widescreen grid with enhanced visual framing and scene metadata tags.

### 🏰 Character Tavern Community Hub Integration
* **Integrated Community Card Hub**: Browse, preview, and download community character cards directly inside AIRI through the new Character Tavern hub integration, available from the card import modal and Onboarding V3.

### 🎨 Workspace Ergonomics, Layout Polish & Platform-Aware Stage
* **Platform-Aware Atmospheric Canvas**: Desktop PC stages now default to clean, zero-overhead background rendering (`none`), while web and mobile stages retain whimsical ambient particles (`hearts`).
* **Summer Sky Meadow Scene**: Added a gorgeous new built-in scenic wallpaper to the stage background gallery.
* **Selective Sync Filter Toggle**: Added a selective sync filter to the Control Strip character switcher, letting you easily filter companions by local vs cloud-synced status.
* **Timeline Switcher in Chat Header**: Switch between branching story timelines and alternative conversation paths directly from the interactive chat header bar.
* **Dedicated "Memories" Popover Subview**: Consolidated short-term memory, long-term text journal, and lifetime grounding controls into a unified "Memories" view inside the Chat Options menu.
* **Frosted Glassmorphism Refinements**: Added 70% opacity frosted glass blur backgrounds and subtle borders to quick-settings popovers and model pickers for enhanced legibility.
* **Rotating Startup Discovery Tips**: Enhanced the desktop splash screen to rotate helpful interaction shortcuts, navigation breadcrumbs, and Audio Studio discovery tips during launch.
* **Advanced Vision Request Parameters**: Added an advanced request parameters JSON editor for vision/VLM backends with proper override precedence handling.
* **Consolidated Model Cache Management**: Added "Installed" filter toggles, slot oversight telemetry, and single-click disk reclamation to local model settings.
* **Mobile Safe-Area Insets**: Fixed iOS notch, dynamic island, and home-bar padding in Pocket, paired with tighter responsive gutters on web.
* **Onboarding V3 Robustness**: Restored manual callback URL input with an inline guidance card for custom Cloudflare relays, and ensured the persona step is preserved for the "Quiet Observer" archetype.

### ⚡ Performance & Audio Pipeline Hardening
* **Speech Synthesis Markdown & Math Sanitization**: Extended the Universal Speech Transformer (UST) to strip out markdown markup and LaTeX math formatting prior to TTS audio synthesis, ensuring voice models don't speak raw markdown tokens or KaTeX syntax aloud *(forward-ported from upstream PR [#3014](https://github.com/moeru-ai/airi/pull/3014) by **@starvingarc**)*.
* **20 Hz Audio Level Metering**: Throttled microphone and speech visualizer audio level metering to 20 Hz, eliminating unnecessary 60fps Vue reactivity churn and layout recalculations while recording *(forward-ported from upstream PR [#3010](https://github.com/moeru-ai/airi/pull/3010) by **@starvingarc**)*.
* **Screen Capture IPC Optimization**: Optimized screen capture event listeners and throttled stationary cursor IPC broadcasts, slashing renderer IPC handling time from 4.1% to 0.8% and stabilizing silky 120fps stage rendering *(forward-ported from upstream PR [#3006](https://github.com/moeru-ai/airi/pull/3006) by **@Makito**)*.
* **Text-Before-Tool Parser Flushing**: Fixed stream parser buffer flushing so conversational text output generated immediately before a tool execution stays positioned at the front of the chat bubble *(forward-ported from upstream PR [#3008](https://github.com/moeru-ai/airi/pull/3008) by **@chiba233**)*.
* **Explicit Terminal Directive on Empty MCP Discovery**: Cleanly returns an explicit directive when an MCP server exposes zero tools instead of leaving the discovery state ambiguous *(forward-ported from upstream PR [#2946](https://github.com/moeru-ai/airi/pull/2946) by **@clansty**)*.
* **Chat Message Storage Hygiene**: Added automatic stripping of oversized inline `data:` image payloads (>32KB) before writing session messages to IndexedDB, keeping local database footprints compact and preventing heap memory bloat across restarts.
