# 🚀 AIRI v0.9.39-stable.20261015 — Release Notes

This release brings a monumental expansion to AIRI's agency, intelligence, and visual workspace: introducing **On-Demand Agent Screenshots**—enabling companions to visually inspect your desktop, individual monitors, or specific application windows whenever they need to—alongside **Intelligent Tool Step Budgeting**, **Hierarchical Chat Staging Controls**, the **Winnow System-1 Memory Compaction Engine**, **Modular Chat Dashboard Cards**, a **Shared Generative Micro-App Catalog**, and **Multi-Instance Model Favorites**.

Companions can now gracefully handle complex multi-step tool loops without abrupt cutoffs, capture and discuss what's on your monitors with inline full-resolution previews, intelligently compact lifetime memories with emotional salience preservation, and let you customize your workspace down to particle atmospheres and per-actor voice overrides.

---

## ✨ Key Highlights

### 👁️ On-Demand Agent Screenshots & Visual Perception
* **Autonomous Visual Inspection (`take_screenshot`)**: Companions can now capture screenshots of your entire desktop, specific monitors, or target application windows on demand when answering visual questions or investigating problems.
* **Inline Multimodal Chat Previews**: Screenshots captured by your companion render directly inside chat message bubbles as rich visual tiles, allowing you to click and inspect captured images in full-resolution view.
* **Multi-Monitor & Window Title Targeting**: Companions can intelligently select specific displays (e.g. primary vs secondary monitor) or capture background windows by exact title match.
* **Card-Level Security & Onboarding Discovery**: Agent screenshot capabilities are securely gated via `allowedTools` in the character editor, controllable in real-time from the chat options menu, and discoverable as an optional tool pack during Onboarding V3.
* **Previewing Attached User Images**: Clicking on any image attached to user messages now opens an expanded high-resolution image preview modal.

### ⏱️ Intelligent Tool Budgets & Graceful Loop Termination
* **Graceful Synthesis at Step Limits**: When a companion exhausts their per-reply tool turns budget (`maxToolSteps`), pending tool executions halt gracefully and the model is given extra turns to synthesize a complete, thoughtful reply rather than abruptly cutting off mid-execution.
* **Unconditional Step Limit Enforcement**: The per-character tool step limit now applies universally across all tools without requiring global sampling parameter overrides to be toggled on.
* **Dedicated Tool Execution Card**: Tool turn limits and history preservation settings have been elevated into an always-visible card at the top of the character editor's Tools & Plugins tab.
* **Collapsible Multi-Tool Blocks**: Consecutive tool executions (such as automated web browsing or file inspections) now collapse into a tidy, expandable summary card ("N tool calls") with individual execution statuses, summaries, and error reporting.

### 🎨 Modular Chat Options Popover & Hierarchical Staging
* **Hierarchical Drill-Down Navigation**: Completely redesigned the monolithic chat options popover into a clean, hierarchical drill-down menu featuring dedicated Appearance, Voice & Audio, Staging, and Model views.
* **Integrated Voice & Audio Controls**: Adjust desktop speech volume, toggle TTS voice generation on/off, and configure multi-actor voice overrides directly from the chat options popover.
* **Appearance & Theme Quick-Picker**: Live-switch between Dark, Light, and System themes, customize chromatic accent palettes, and select ambient stage backgrounds from an integrated wallpaper grid.
* **Jank-Free Atmospheric Canvas**: Re-engineered background particle and atmosphere canvases to eliminate redundant texture allocations, rAF loop stacking, and layout thrashing, ensuring smooth 60fps transitions.
* **Inline Reasoning Lens**: Added an inline focus lens for inspecting Chain-of-Thought (CoT) reasoning traces without cluttering conversation history.

### 🧠 Winnow System-1 Memory Compaction & Lifetime Thread Hardening
* **Winnow Salience-Preserving Compaction**: Introduced the `winnow` compaction strategy using System-1 Jev coprocessors: high-salience turns, emotional anchors, and `<|ACT:*|>` cues are preserved verbatim while routine conversational filler is pruned, capped strictly at 75% of context width to eliminate infinite compaction loops.
* **Surgical Section Locking**: Enhanced Pillar 5 lifetime memory with surgical section locks, preventing re-synthesized memory summaries from overwriting established character lore.
* **Modernized Provisioning Modal**: Redesigned the Eternal Thread provisioning interface with active-universe isolation, manual "Sync Thread Now" controls, sealed watermarks, and live context injection diagnostics.
* **Comprehensive Memory Test Suite**: Validated lifetime artifact synthesis and retention with an exhaustive 70-test suite covering edge cases F-01 through F-08.

### 🖥️ In-Memory Virtual Terminal & Starter Micro-App Catalog
* **Shared Micro-App Catalog**: Bundled interactive generative widgets into a unified 3×2 starter grid featuring Haven Weather, Daily Checklist, and System Monitor presets.
* **In-Place Reactive State Synchronization**: Generative widgets can now mutate and synchronize state bidirectionally with companion chat memory while inheriting dynamic application themes.
* **Standalone Breakout Windows with DevTools**: Pop out generative widgets into standalone desktop windows with dedicated developer tools shortcuts (`F12`, `Cmd+Option+I`) and context menus.
* **Universal MCP Tool Dispatcher**: Decomposed universal Model Context Protocol (MCP) tool execution and wired TypeSafe Jev System-1 decisions natively into MCP calls.
* **CloudSync Deletion Tombstones**: Added deletion tombstones for generative micro-apps to eliminate zombie widget resurrection across multi-device cloud synchronization.

### 🛠️ Desktop Experience & Navigation Polish
* **Modular Chat Dashboard Cards**: Added customizable header controls and flexible layout configurations to the embedded chat dashboard panel, with stage window visibility decoupled from the desktop companion.
* **Model Favorites Manager (`BrainModelFavoriteModal`)**: Added a full-featured model favorites manager supporting multi-instance cloud providers, custom parameters, and adaptive Light/Dark styling.
* **Intelligent Avatar Search**: Expanded model selector search to query tags, franchise groups, and multi-word terms.
* **Responsive Grounding Header**: Grounding status indicators now gracefully scale down on compact window widths (<456px), and empty journal strips automatically collapse.
* **Fuzzy Mascot Sticker Matching**: Mascot sticker resolution now fuzzy-matches IDs across format extensions, casing, and prefixes.
* **V3-Only Onboarding Gate**: Permanently pruned legacy V1 and V2 onboarding flags, standardizing all first-run setups on the streamlined 18-step Onboarding V3 flow.
* **Audio Playback Wiring**: Properly wired speaker volume controls and TTS mute switches directly into active desktop audio playback.

---

## 🤝 Community Pull Requests

* **PR [#22](https://github.com/dasilva333/airi/pull/22): feat: add screenshot support to the agent** — Contributed by **@meckbaig**, adding on-demand agent screenshots (`take_screenshot`), multi-display/window targeting, inline multimodal chat rendering, and onboarding tool integration.
* **PR [#24](https://github.com/dasilva333/airi/pull/24): feat(stage-ui,stage-pages): graceful stop + per-character limit actually applied** — Contributed by **@meckbaig**, implementing graceful tool loop termination at step limits, making character tool step limits unconditionally active, and consolidating tool controls.
* **PR [#26](https://github.com/dasilva333/airi/pull/26): fix(stage-tamagotchi): collapse hidden journal strip and make grounding header responsive** — Contributed by **@meckbaig**, refining compact desktop window responsiveness and collapsing idle journal strips.

