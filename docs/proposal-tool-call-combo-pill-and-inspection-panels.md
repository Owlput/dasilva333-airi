# Proposal: Chat Tool-Call Strips & Inspection Drawers ("One Group. Two Display Preferences")

> **Living Architecture & Design Specification**
> * **Status:** Refined Design Specification (Community Reviewed)
> * **Author:** Richard Pinedo (`@dasilva333`), with upstream attribution to 蓝莓🫐 (`@chiba233`)
> * **Design Critique & Community Contributors:** `@meckbaig`, `@Sillar`, `@Kayo/Kyo`, `@ホシノ夢華`
> * **Date:** October 16, 2026
> * **Upstream Citations:**
>   - Upstream PR [#2990](https://github.com/moeru-ai/airi/pull/2990): `feat(stage-ui): show tool calls as a combo pill with tool icons` by 蓝莓🫐 (`@chiba233`)
>   - Upstream PR [#2992](https://github.com/moeru-ai/airi/pull/2992): `feat(stage-ui): polish the unfolded tool call panel` by 蓝莓🫐 (`@chiba233`)
>   - Upstream PR [#2994](https://github.com/moeru-ai/airi/pull/2994): `feat(stage-ui): add rich result widgets for tools` by 蓝莓🫐 (`@chiba233`)
> * **Target Systems:**
>   - `packages/stage-ui/src/components/scenarios/chat/components/` (`tool-call-*`)
>   - `packages/stage-ui/src/tools/icons.ts` & `metadata.ts` (Icon and friendly label resolution)
>   - `packages/stage-ui/src/stores/chat.ts` (Tool execution lifecycle & persistence)
>   - `packages/i18n/src/locales/` (`stage.chat.tool-calls.*`)

---

## 1. Executive Summary & Design Evolution

### 1.1 The Transcript Bloat Problem
As AIRI companions execute multi-step automations—such as Computer Use (`computer_use`), Swarm Automation (`spark:command`), Web Research (`web_search`), Terminal scripts (`bash`), and Sacred Journaling (`text_journal`)—the desktop chat transcript suffers severe vertical bloat. In the legacy implementation, every tool invocation rendered an independent full-width card with raw JSON arguments. A 23-call execution sequence (e.g., Kurisu running multi-step bash inspections and a memory write) generated over 3,000px of vertical clutter, pushing conversation dialogue off-screen.

### 1.2 Upstream Critique: Excising Gamified "Combos" in Favor of "Calls"
Upstream PRs [#2990](https://github.com/moeru-ai/airi/pull/2990) and [#2992](https://github.com/moeru-ai/airi/pull/2992) by `@chiba233` introduced the initial collapsed horizontal pill concept, but relied on arcade gamification terminology: `连击 x5` ("Combo ×5"), `3-hit combo, 1 missed`, and loosely spaced glyph blocks.

Community review raised immediate technical and product pushback:
- **`@meckbaig`**: *"Is that a consecutive tool call collapse thing? What do combos mean 😕 Gamification 😕 Why... I prefer 'calls'. And idk about simplification, I have enough pixels on my screen to display command names inside this strip."*
- **`@Sillar`**: *"If we have combos then what do we start calling errors in the middle? C-c-c-combo breakers 🥁 🥁 😏 Ok jokes aside also agree with tighter spacing. A bit tighter."*
- **`@dasilva333`**: *"I was taken aback when I saw Chiba's use of the word combos and meck is right to point that out, feels kinda cringe tbh. I would stick to 'calls' too. But the concept of icons stacking with an × count indicator is cleaner, more modern and polished... I’ll combine Chiba’s compact grouping with meck’s point about readability, and mock up a strip that can switch between icons and names."*

### 1.3 The Core Solution: "One Group. Two Display Preferences"
This specification eliminates gamification and formalizes a unified, high-density toolbar with **two user-selectable display preferences**:
1. **Compact Mode**: Minimal footprint showing the status pill, tool icons, and count multipliers (`×22`, `×1`).
2. **Names Mode**: Expands tool icons with friendly human-readable metadata labels (`Terminal ×22`, `Journal ×1`) rather than raw internal function IDs.
3. **`[Aa]` Display Switcher**: A header toggle allowing instant switching between Compact and Names modes, backed by `localStorage` persistence.
4. **Folded Earlier History**: High-count sequences (e.g. 23 calls) fold older items into an accordion (`... 20 earlier calls`) to keep the unfolded inspection panel clean and actionable.
5. **Tighter Spacing**: Compact `px-1.5 py-0.5` chip geometry with subtle 1px vertical dividers (`|`).

---

## 2. Visual & Interaction Architecture

### 2.1 The Two Display Preferences (`Compact` vs. `Names`)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        ONE GROUP. TWO DISPLAY PREFERENCES                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│ 1. COMPACT MODE (Default for space-constrained windows / icon purists):                │
│    ┌──────────────────────────────────────────────────────────────────────────────┐    │
│    │  🟢 23 calls  │  [ >_ ] ×22    [ ✍️ ] ×1                   │  [ Aa ]  [ ∨ ]   │    │
│    └──────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                        │
│ 2. NAMES MODE (User clicked [Aa] or wide desktop space available):                     │
│    ┌──────────────────────────────────────────────────────────────────────────────┐    │
│    │  🟢 23 calls  │  [ >_ ] Terminal ×22    [ ✍️ ] Journal ×1   │  [ Aa*]  [ ∨ ]   │    │
│    └──────────────────────────────────────────────────────────────────────────────┘    │
│                                              │                                         │
│                                              ▼ Click [ ∨ ] to Unfold                   │
│                                                                                        │
│ 3. EXPANDED VIEW WITH FOLDED EARLIER HISTORY:                                          │
│    ┌──────────────────────────────────────────────────────────────────────────────┐    │
│    │  🟢 23 calls  │  [ >_ ] Terminal ×22    [ ✍️ ] Journal ×1   │  [ Aa*]  [ ∧ ]   │    │
│    ├──────────────────────────────────────────────────────────────────────────────┤    │
│    │  ⋮  20 earlier calls                                                 [ ∨ ]   │    │
│    │ ──────────────────────────────────────────────────────────────────────────── │    │
│    │  21   [ >_ ] Terminal  bash                                  🟢 Done [ ∨ ]   │    │
│    │  22   [ >_ ] Terminal  bash                                  🟢 Done [ ∨ ]   │    │
│    │  23   [ ✍️ ] Journal   text_journal                           🟢 Done [ ∧ ]   │    │
│    │       ├── Arguments:                                                         │    │
│    │       │     { "entry": "Saved a conversation note." }                        │    │
│    │       └── Result:                                                            │    │
│    │             "Saved"                                                          │    │
│    └──────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Micro-Interactions & Spacing Polish
Addressing the critiques by `@meckbaig` and `@Sillar`:
- **Tighter Spacing**: Chip horizontal margin reduced to `gap-1.5`, with chip inner padding set to `px-2 py-0.5`. Icon, label, and counter multiplier are grouped tightly:
  ```html
  <div class="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-neutral-100/70 dark:bg-neutral-800/60">
    <i :class="tool.icon" class="text-xs" />
    <span v-if="showToolNames" class="text-xs font-medium text-neutral-800 dark:text-neutral-200">{{ tool.label }}</span>
    <span class="text-xs text-neutral-500 font-mono">×{{ tool.count }}</span>
  </div>
  ```
- **Structural Dividers**: Subtle vertical dividers (`h-3.5 w-px bg-neutral-200 dark:bg-neutral-700/60`) cleanly separate:
  1. The summary status badge (`🟢 23 calls`).
  2. The tool breakdown chips list.
  3. The action controls (`[Aa]` toggle and expand chevron `[∨]`).
- **Edge Scroll Fades**: Long argument and result bodies in the expanded drawer scroll with dynamic CSS edge masks rather than heavy `backdrop-filter: blur()`:
  ```css
  mask-image: linear-gradient(to bottom, transparent, black 12px, black calc(100% - 12px), transparent);
  ```
- **1px Nesting Guides**: Child object hierarchies use clean 1px vertical borders (`border-l border-neutral-300 dark:border-neutral-700/60`).
- **Type-Specific Syntax Coloring**: Monospace formatting with neutral text for strings, theme accent for numbers, and muted gray for booleans/nulls.

---

## 3. Preference Persistence & Open Architectural Questions

### 3.1 `localStorage` Preference Binding
The `[Aa]` toggle state is bound to persistent client storage:
- **Storage Key**: `airi:chat:tool-calls-display-mode`
- **Supported Values**: `'compact' | 'names' | 'auto'` (Default: `'auto'`)
- When the user explicitly clicks the `[Aa]` button, the setting updates immediately:
  - If currently in Compact $\rightarrow$ writes `'names'`.
  - If currently in Names $\rightarrow$ writes `'compact'`.

### 3.2 Open Decision Point: Explicit User Intent vs. Responsive Constraints

A critical interaction nuance exists when resolving conflicts between **explicit user preference** and **physical screen size**:

> *If a user explicitly toggled `[Aa]` to "Names" mode on their desktop, and then resizes the window to portrait mode (or runs on a narrow mobile companion screen), who wins: Explicit Preference or Responsive Constraints?*

#### Evaluation of Resolution Strategies:

| Strategy | Behavior in Narrow / Portrait View | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **Strategy A: Responsive Soft-Suppression with Sticky Intent (Recommended)** | If container width $< 420\text{px}$, labels are temporarily suppressed to Compact mode even if `localStorage === 'names'`. Upon widening, Names mode automatically returns. | Guarantees zero layout overflow or ugly text clipping in narrow portrait windows; preserves user intent upon window restoration. | Explicit preference is temporarily bypassed while window is narrow. |
| **Strategy B: Strict Explicit Respect with Clamped Truncation** | Always renders names if explicitly selected. In narrow containers, tool labels truncate via CSS (`truncate max-w-16`) or the strip enables smooth horizontal trackpad scrolling (`overflow-x-auto no-scrollbar`). | 100% fidelity to user's explicit command; never second-guesses the user. | Chips can look cramped in very narrow viewports ($< 340\text{px}$). |
| **Strategy C: Tri-State Auto / Explicit** | If key is unset or `'auto'`, pure responsiveness dictates mode ($> 520\text{px} \implies \text{Names}$, $\le 520\text{px} \implies \text{Compact}$). If set to explicit `'names'` or `'compact'`, explicit wins unconditionally. | Clear semantic separation between default auto behavior and manual overrides. | Requires handling edge-case horizontal scroll in portrait when `'names'` is forced. |

> [!NOTE]
> **Recommended Baseline**: Adopt **Strategy A with Horizontal Pill Scrolling fallback**. If container width drops below $420\text{px}$, tool chips enable touch/wheel horizontal drag (`overflow-x-auto`) rather than destroying text, while falling back to compact glyphs only if width falls below $320\text{px}$.

---

## 4. Metadata & Tool Label Resolution Engine

Rather than displaying raw technical function identifiers (e.g. `bash`, `text_journal`, `computer_use`), the UI resolves friendly human-readable labels from tool definition metadata, falling back to i18n keys:

```typescript
// packages/stage-ui/src/tools/metadata.ts

export interface ToolMetadataDisplay {
  label: string
  icon: string
  description?: string
}

export const TOOL_METADATA_REGISTRY: Record<string, ToolMetadataDisplay> = {
  bash: {
    label: 'Terminal',
    icon: 'i-mingcute:terminal-box-line',
  },
  bash_exec: {
    label: 'Terminal',
    icon: 'i-mingcute:terminal-box-line',
  },
  text_journal: {
    label: 'Journal',
    icon: 'i-mingcute:book-2-line',
  },
  image_journal: {
    label: 'Gallery',
    icon: 'i-mingcute:pic-line',
  },
  computer_use: {
    label: 'Computer use',
    icon: 'i-mingcute:computer-line',
  },
  web_search: {
    label: 'Web search',
    icon: 'i-mingcute:search-2-line',
  },
  get_weather: {
    label: 'Weather',
    icon: 'i-mingcute:cloud-sun-line',
  },
  builtIn_readMemory: {
    label: 'Memory',
    icon: 'i-mingcute:brain-line',
  },
}

export function resolveToolDisplay(toolName: string): ToolMetadataDisplay {
  if (TOOL_METADATA_REGISTRY[toolName])
    return TOOL_METADATA_REGISTRY[toolName]

  // MCP Servers: mcp::<server>::<tool>
  if (toolName.startsWith('mcp::') || toolName.startsWith('mcp_')) {
    const parts = toolName.split('::')
    return {
      label: parts[1] || 'MCP',
      icon: 'i-mingcute:plugin-2-line',
    }
  }

  // Recipes / SOPs
  if (toolName.startsWith('builtIn_useRecipe') || toolName.startsWith('recipe::')) {
    return {
      label: 'Recipe',
      icon: 'i-mingcute:magic-wand-line',
    }
  }

  // Default Fallback
  return {
    label: toolName,
    icon: 'i-mingcute:tool-line',
  }
}
```

In the expanded inspection drawer, **both** names are rendered side-by-side:
```
23   [ ✍️ ] Journal   text_journal                           🟢 Done [ ∧ ]
```
The friendly label (`Journal`) gives immediate visual context, while the monospace tag (`text_journal`) provides exact technical fidelity.

---

## 5. Specialized Result Widgets (PR #2994)

When a tool item in the inspection drawer is unfolded, raw JSON outputs are replaced with rich, domain-specific visual cards:

### 5.1 🖥️ `computer_use` Result Widget
- **Action Badge**: `invoke app.launch`, `invoke input.click`, or `invoke display.capture`.
- **Target Coordinates / Window Title**: Formatted metadata tags.
- **Inline Frame Preview**: Thumbnail of the captured screen crop with a 1-click modal expander, allowing the user to inspect what the companion saw.

### 5.2 ⚡ `spark:command` Directives Widget
- **Target Destination Badges**: `web-extension`, `minecraft-bot`, `vscode-plugin`.
- **Intent Tags**: `action`, `plan`, `proposal`, `interrupt`.
- **Delivery Status**: Emitted $\rightarrow$ Acknowledged $\rightarrow$ Settled.

### 5.3 🌐 `web_search` Citations Widget
- Top 3 source badges with parsed domain favicons.
- Extracted answer snippet accordion with markdown formatting.
- Verbatim link pills that open safely in the external default browser.

### 5.4 📖 `text_journal` Memory Inscription Widget
- Formatted entry preview (title, body, sentiment).
- Universe tag badge (`universeId` or `global`).
- Immutable inscription confirmation checkmark (`#sacred-journal-rule`).

---

## 6. File Manifest & Architecture Seams

| Component Path | Responsibility |
| :--- | :--- |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-group.vue` | Orchestrates the sequential tool list, manages `[Aa]` toggle state, and handles expand/collapse transitions. |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-strip.vue` | High-density horizontal toolbar rendering summary badge, tool breakdown chips, `[Aa]` button, and expand chevron. |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-unfolded-panel.vue` | Translucent flyout drawer with `... N earlier calls` accordion, 1px indent tree guides, and copy action buttons. |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-widget-computer-use.vue` | Specialized inspection card for `computer_use` actions and screenshot artifacts. |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-widget-spark.vue` | Specialized inspection card for `spark:command` swarm directives. |
| `packages/stage-ui/src/tools/metadata.ts` | Tool icon and friendly metadata label resolution cascade. |
| `packages/stage-ui/src/components/scenarios/chat/AssistantMessage.vue` | Ingestion seam: replaces legacy full-width tool cards with `<ToolCallGroup />`. |

---

## 7. Implementation & Verification Plan

1. **Component Scaffolding**:
   - Create `tool-call-strip.vue` and `tool-call-unfolded-panel.vue`.
   - Wire `useLocalStorage('airi:chat:tool-calls-display-mode', 'auto')` with manual toggle handlers.
2. **Spacing & Dividers**:
   - Implement tight `px-1.5 py-0.5` chip geometry with subtle 1px dividers.
   - Verify layout in both Light and Dark themes per the design mockup.
3. **Folded Earlier History**:
   - Implement the `... N earlier calls` fold threshold (default: fold if $> 3$ calls).
4. **Verification Suites**:
   - `pnpm -F @proj-airi/stage-ui test src/components/scenarios/chat/components/tool-call-group.test.ts`
   - `pnpm -F @proj-airi/stage-ui typecheck`
   - Test in desktop Electron chat with 20+ sequential tool calls (e.g. bash scripts) to confirm zero transcript clutter and smooth expand animations.
