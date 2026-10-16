# Proposal: Chat Tool-Call Combo Pills & Unfolded Inspection Drawers

**Status:** Proposed Architecture & Integration Specification
**Author:** AIRI Engineering
**Date:** October 16, 2026
**Upstream Citations & Attribution:**
- Upstream PR [#2990](https://github.com/moeru-ai/airi/pull/2990): `feat(stage-ui): show tool calls as a combo pill with tool icons` by 蓝莓🫐 (`@chiba233`) — Commit `9b27b007b5` (2026-10-16)
- Upstream PR [#2992](https://github.com/moeru-ai/airi/pull/2992): `feat(stage-ui): polish the unfolded tool call panel` by 蓝莓🫐 (`@chiba233`) — Commit `bceda51e5e` (2026-10-16)
- Upstream PR [#2994](https://github.com/moeru-ai/airi/pull/2994): `feat(stage-ui): add rich result widgets for tools` by 蓝莓🫐 (`@chiba233`)
**Target Systems:**
- `packages/stage-ui/src/components/scenarios/chat/components/` (`tool-call-*`)
- `packages/stage-ui/src/tools/icons.ts` (Tool icon resolution engine)
- `packages/stage-ui/src/stores/chat.ts` (Tool execution lifecycle)
- `packages/i18n/src/locales/` (`stage.chat.tool-calls.*`)

---

## 1. Executive Summary & Motivation

### 1.1 The Transcript Bloat Problem
As AIRI companions execute multi-step automation—such as Computer Use (`computer_use`), Swarm Automation (`spark:command`), Web Research (`web_search`), and Sacred Journaling (`text_journal`)—the desktop chat transcript suffers severe vertical degradation.

In the legacy implementation, every single tool call was rendered as an independent full-width card with raw JSON arguments and stringified results. A 5-step task generated over 800px of vertical clutter, pushing conversation dialogue off-screen, overwhelming users, and obscuring companion responses.

### 1.2 The Combo Pill & Inspection Drawer Solution
Originating from the design work of 蓝莓🫐 (`@chiba233`) in upstream PRs #2990, #2992, and #2994, this proposal ports and standardizes a high-density, accessible presentation pattern:

1. **Compact Combo Pill (`tool-call-combo-pill.vue`)**: Collapses sequential or parallel tool calls within an assistant turn into a unified horizontal capsule showing a `Combo ×N` counter, MingCute tool icons, animated spinners for active executions, and status dots (green = settled, red = failed).
2. **Unfolded Inspection Panel (`tool-call-unfolded-panel.vue`)**: Clicking the pill unfolds a floating, non-intrusive drawer with 1px indentation nesting guides, JSON type-specific syntax coloring, copyable argument/result payloads, execution latency metrics, and row rerun triggers.
3. **Specialized Result Widgets**: Replaces raw JSON dumps with domain-specific cards for Computer Use, Spark swarm commands, Web search sources, and Journal memory entries.

---

## 2. Visual & Interaction Architecture

### 2.1 State Progression of a Tool Call
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              TOOL CALL LIFECYCLE STATES                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   1. INVOKING (Streaming):                                                             │
│      ┌─────────────────────────────────────────────────────────────────────────────┐   │
│      │  [ 🌀 computer_use ] [ ⚙️ web_search ]  Combo ×2  Running...                 │   │
│      └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
│   2. SETTLED (Collapsed):                                                              │
│      ┌─────────────────────────────────────────────────────────────────────────────┐   │
│      │  [ 🟢 🖥️ computer_use ] [ 🟢 🌐 web_search ]  Combo ×2                      │   │
│      └─────────────────────────────────────────────────────────────────────────────┘   │
│                                      │ (Click to Expand)                               │
│                                      ▼                                                 │
│   3. UNFOLDED (Inspection Drawer):                                                     │
│      ┌─────────────────────────────────────────────────────────────────────────────┐   │
│      │ 🖥️ computer_use                                              🟢 Done  [ 📋 ] │   │
│      │ ├── Arguments:                                                              │   │
│      │ │   ├── action: "display.capture"                                           │   │
│      │ │   └── window: "Spotify"                                                   │   │
│      │ └── Result:                                                                 │   │
│      │     ├── exit_code: 0                                                        │   │
│      │     └── [ 🖼️ Screenshot Preview Drawer (Click to inspect full crop) ]       │   │
│      │ ─────────────────────────────────────────────────────────────────────────── │   │
│      │ 🌐 web_search                                                🟢 Done  [ 📋 ] │   │
│      │ ├── Query: "weather in Tokyo tonight"                                       │   │
│      │ └── Sources: 3 citations parsed [Expand]                                    │   │
│      └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Key Micro-Interactions (PR #2992 Polish Invariants)
- **Edge Fades Over Backdrop Blur**: Long JSON arguments and results scroll inside a max-height container. Rather than cutting text abruptly or using heavy `backdrop-filter: blur()` (which causes jagged border artifacts in Chromium/Electron), the panel applies dynamic CSS scroll edge masks:
  ```css
  mask-image: linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent);
  ```
  The fade smoothly disappears when the user reaches the absolute top or bottom of the scroll container.
- **1px Nesting Guides**: Child object properties use a faint 1px vertical guide (`border-l border-neutral-300 dark:border-neutral-700/60`), eliminating the heavy 4px theme-color blocks of previous iterations.
- **Type-Specific Syntax Coloring**:
  - `string`: Soft quote wrappers with neutral text (`text-neutral-700 dark:text-neutral-200`).
  - `number`: Primary theme accent (`text-primary-600 dark:text-primary-400`).
  - `boolean` / `null`: Muted monospace gray (`text-neutral-400 dark:text-neutral-500 font-mono`).
- **Reactive Hit Keys**: Hit keys are registered as `toolCallId#occurrence`. Streamed result chunks append without remounting DOM chips or triggering layout jitter.

---

## 3. Specialized Result Widgets (PR #2994)

### 3.1 🖥️ `computer_use` Result Widget
When the companion invokes OS automation via AUV (`apps/stage-tamagotchi/src/main/services/airi/computer-use.ts`), raw output includes exit codes, process PIDs, and screenshot artifacts. The specialized widget displays:
- **Action Badge**: `invoke app.launch`, `invoke input.click`, or `invoke display.capture`.
- **Target Coordinates / Window**: Clean metadata tags.
- **Inline Frame Preview**: For capture commands, renders a thumbnail of the saved screenshot crop with a 1-click modal expander, allowing the user to inspect exactly what the companion saw.

### 3.2 ⚡ `spark:command` Directives Widget
For swarm automation over WebSocket port 6121:
- **Target Destination Badges**: `web-extension`, `minecraft-bot`, `vscode-plugin`.
- **Intent Tags**: `action`, `plan`, `proposal`, `interrupt`.
- **Priority Indicator**: High / Normal / Low.
- **Delivery Status**: Emitted $\rightarrow$ Acknowledged $\rightarrow$ Settled.

### 3.3 🌐 `web_search` Citations Widget
Replaces massive search JSON dumps with:
- Top-3 source badges with parsed domain favicons.
- Extracted answer snippet accordion with markdown formatting.
- Verbatim link pills that open safely in external default browser.

### 3.4 📖 `text_journal` Memory Inscription Widget
When the companion records an entry to Long-Term Memory (LTMM / Sacred Journal):
- Formatted entry preview (title, body, sentiment).
- Universe tag badge (`universeId` or `global`).
- Immutable inscription confirmation checkmark (`#sacred-journal-rule`).

---

## 4. Tool Icon Resolution Engine

In `packages/stage-ui/src/tools/icons.ts`, icons resolve deterministically across three tiers:

```typescript
import type { ToolDefinition } from '@proj-airi/stage-ui/types'

export const TOOL_ICONS: Record<string, string> = {
  // Built-in OS & System
  computer_use: 'i-mingcute:computer-line',
  computer_use_read_image: 'i-mingcute:pic-line',
  spark_command: 'i-mingcute:sparkles-line',
  web_search: 'i-mingcute:search-2-line',
  text_journal_create: 'i-mingcute:book-2-line',
  text_journal_search: 'i-mingcute:book-read-line',
  generate_motion: 'i-mingcute:run-line',
  bash_exec: 'i-mingcute:terminal-box-line',

  // High-level Capabilities
  weather: 'i-mingcute:cloud-sun-line',
  home_assistant: 'i-mingcute:home-4-line',
  discord_send: 'i-mingcute:discord-line',
}

export function resolveToolIcon(tool: ToolDefinition | string): string {
  const name = typeof tool === 'string' ? tool : tool.name

  // 1. Explicit icon declared in ToolDefinition
  if (typeof tool !== 'string' && tool.icon)
    return tool.icon

  // 2. Exact match in canonical tool registry
  if (TOOL_ICONS[name])
    return TOOL_ICONS[name]

  // 3. Category Fallbacks
  if (name.startsWith('mcp::') || name.startsWith('mcp_'))
    return 'i-mingcute:plugin-2-line'
  if (name.startsWith('recipe::') || name.startsWith('builtIn_useRecipe'))
    return 'i-mingcute:magic-wand-line'
  if (name.startsWith('jev::'))
    return 'i-mingcute:cpu-line'

  // 4. Generic Tool Fallback
  return 'i-mingcute:tool-line'
}
```

---

## 5. File Manifest & Architecture Seams

| Component Path | Responsibility |
| :--- | :--- |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-group.vue` | Orchestrates sequential tool calls, manages reactive hit keys, and handles expand/collapse transitions. |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-combo-pill.vue` | Renders the compact horizontal capsule, MingCute icons, status dots, and streaming spinner. |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-unfolded-panel.vue` | Translucent flyout drawer, scroll edge fades, 1px indent tree guides, and copy action buttons. |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-widget-computer-use.vue` | Specialized inspection card for `computer_use` actions and screenshot artifacts. |
| `packages/stage-ui/src/components/scenarios/chat/components/tool-call-widget-spark.vue` | Specialized inspection card for `spark:command` swarm directives. |
| `packages/stage-ui/src/tools/icons.ts` | 4-tier icon resolution cascade using MingCute line icon set. |
| `packages/stage-ui/src/components/scenarios/chat/AssistantMessage.vue` | Ingestion seam: replaces legacy tool card loop with `<ToolCallGroup />`. |

---

## 6. Implementation & Verification Plan

1. **Icon Assets**: Ensure `@iconify-json/mingcute` is installed in `packages/stage-ui` dependencies.
2. **Component Port**: Port `tool-call-group.vue`, `tool-call-combo-pill.vue`, and `tool-call-unfolded-panel.vue` into `packages/stage-ui/src/components/scenarios/chat/components/`.
3. **i18n Translation Keys**: Add missing localized keys (`stage.chat.tool-calls.*`) in `packages/i18n/src/locales/en/stage.yaml` and `zh-Hans/stage.yaml`.
4. **Verification Suites**:
   - `pnpm -F @proj-airi/stage-ui test src/components/scenarios/chat/components/tool-call-group.test.ts`
   - `pnpm -F @proj-airi/stage-ui typecheck`
   - Test streaming tool invocations in desktop Electron chat, verifying that active chips animate smoothly without remounting.
