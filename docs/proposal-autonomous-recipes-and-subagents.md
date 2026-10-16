# Proposal: Autonomous Recipes & Background Sub-Agent Task Engine

**Status:** Proposed Architecture & Integration Specification
**Author:** AIRI Engineering
**Date:** October 16, 2026
**Upstream Citations & Attribution:**
- Upstream PR [#2748](https://github.com/moeru-ai/airi/pull/2748): `feat: add skills, long-term memory, and background tasks` by 蓝莓🫐 (`@qwq`) — Commit `d70ab4dd32` (2026-10-15)
- Upstream Architecture Note: `docs/ai/adr/2026-10-10-skills-automations-and-memory.md`
**Target Systems:**
- `packages/stage-ui/src/stores/recipes.ts` (Recipe registry & task session runner)
- `packages/stage-ui/src/database/repos/recipes.repo.ts` (`local:recipes/*` unstorage repository)
- `packages/stage-ui/src/libs/sandbox/manager.ts` (Virtual workstation CLI: `recipe run`, `require('recipe')`)
- `packages/stage-ui/src/stores/chat.ts` (Notice injection & System-1 dispatch)
- `packages/stage-pages/src/pages/settings/recipes/` (`Settings > Recipes` management UI)

---

## 1. Executive Summary & Motivation

### 1.1 The "Single-Context" Agent Bottleneck
In conventional conversational companions, when a user asks the assistant to perform an involved multi-step task (e.g., *"Browse arXiv for the latest RWKV papers, take notes in the journal, and organize my desktop"*), the entire task is forced through the primary conversation transcript.

This creates three critical architectural flaws:
1. **Prompt Memory Pollution**: 10–20 intermediate tool-call turns and raw tool outputs fill the main context window, displacing conversational persona and character lore.
2. **Context Latency & Cost Lock**: The user cannot have a normal conversation while the companion is busy; the main LLM loop is blocked waiting for multi-step tool iterations.
3. **Fragile Autoregressive Planning**: The primary conversational model drifts off-track, mixing task-execution instructions with roleplay persona.

### 1.2 The Recipe & Sub-Agent Solution
Adapted from upstream PR #2748 and unified with AIRI's **System-1 Jev Decision Engine** and **In-Memory POSIX Virtual Workstation**, this proposal formalizes **Recipes** as declarative Standard Operating Procedures (SOPs) executed in **isolated background task sessions**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        RECIPE ORCHESTRATION ARCHITECTURE                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   1. TRIGGER CHANNELS                                                                  │
│      ├── Channel A: System-1 Gating Classifier (Fast 100ms triage -> recipe)           │
│      ├── Channel B: Primary LLM Tool Call (builtIn_useRecipe)                          │
│      ├── Channel C: Workstation Bash Script (recipe run <name> / require('recipe'))    │
│      └── Channel D: Auto-Run Keyword Receptors                                         │
│                                      │                                                 │
│                                      ▼                                                 │
│   2. ISOLATED TASK SESSION SPACE                                                       │
│      ┌─────────────────────────────────────────────────────────────────────────────┐   │
│      │ System Prompt: Recipe Purpose + Step-by-Step SOP                            │   │
│      │ Tool Whitelist: web_search, computer_use, text_journal, spark_command       │   │
│      │ Memory: Clean isolated memory context (Does NOT touch owner chat transcript)│   │
│      │ Loop: Bounded autonomous execution (Max 8 turns, 120s timeout)              │   │
│      └─────────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                                 │
│                                      ▼                                                 │
│   3. ASYNCHRONOUS NOTICES LEDGER                                                       │
│      ┌─────────────────────────────────────────────────────────────────────────────┐   │
│      │ Injects into Owner Chat Ledger:                                             │   │
│      │ "[Notice from recipe:daily_brief, not a message from the owner.]            │   │
│      │  The background task 'daily_brief' finished.                                │   │
│      │  Result: 3 papers found and summarized to your journal.                     │   │
│      │  [Speak about this notice only if it fits now, or stay quiet.]"             │   │
│      └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Recipe Schema & Persistence

Recipes are persisted in IndexedDB via `unstorage` under `local:recipes/{id}`:

```typescript
export interface AiriRecipe {
  id: string
  name: string
  description: string
  version: string
  author?: string

  /** Step-by-step Standard Operating Procedure compiled into the task system prompt */
  sopInstructions: string

  /** Whitelist of tool IDs available during task execution */
  allowedTools: string[]

  /** Maximum number of autonomous iterations before forced termination */
  maxTurns: number

  /** Auto-run keyword triggers (optional) */
  autoRun?: {
    enabled: boolean
    keywords: string[]
    confidenceThreshold?: number
  }

  /** System-1 classification intent tag */
  category?: 'research' | 'automation' | 'maintenance' | 'creative'
}
```

---

## 3. Four Invocation Channels

### Channel 1: System-1 Pre-Turn Gating (`airi-jev-decision-engine`)
As established in [`docs/proposal-dusha-coprocessor.md`](./proposal-dusha-coprocessor.md), when a turn arrives in `universe_rag` mode, System-1 Jev evaluates the 3-way gate in ~100ms:
```typescript
const gate = await systemOneStore.execute(userMessage, {
  action: {
    type: 'choice',
    instructions: 'Should the companion reply in dialogue, stay quiet, or launch a task recipe?',
    criteria: {
      reply: 'Conversational remark, greeting, or direct question.',
      silence: 'Routine filler or self-directed thought.',
      recipe: 'Structured multi-step task (e.g. "summarize my emails", "audit our git repository").',
    },
  },
})

if (gate.answers?.action?.choice === 'recipe') {
  // Bypasses the primary LLM completely, saving tokens and launching the sub-agent
  await recipesStore.launchTaskSession({ recipeId: matchedRecipeId, input: userMessage })
  // Instant exit
}
```

### Channel 2: Primary Conversational Tool (`builtIn_useRecipe`)
When the primary companion is chatting and decides a request requires background work, it invokes the built-in tool:
```json
{
  "tool": "builtIn_useRecipe",
  "arguments": {
    "recipeId": "academic_researcher",
    "task": "Find recent breakthroughs in WebGPU quantized inference"
  }
}
```
The companion responds immediately with a natural vocal promise (e.g., *"I'm on it! I'll look into those papers while we chat"*), and the recipe runs asynchronously in the background.

### Channel 3: Virtual Workstation Bash Script (`airi-sandbox-virtual-workstation`)
Because AIRI features an in-memory POSIX virtual workstation (`just-bash` + `/workspace` RAM disk), characters can write automation scripts that invoke sub-agents:

1. **POSIX Shell CLI**:
   ```bash
   recipe run academic_researcher --input "WebGPU quantized inference" --output /workspace/research.json
   ```
2. **In-Memory Node.js Scripting**:
   ```javascript
   const fs = require('node:fs')

   const recipe = require('recipe')

   const result = await recipe.run('academic_researcher', {
     query: 'WebGPU quantization'
   })

   fs.writeFileSync('/workspace/notes.txt', result.summary)
   ```

### Channel 4: Auto-Run Keyword Receptors
Configurable trigger phrases stored on the recipe (e.g., *"brief me"*, *"organize files"*) that automatically awaken the task session when spoken by the user.

---

## 4. Isolated Task Session Lifecycle

When a task session launches:
1. **Isolated Context Construction**:
   - Compiles a dedicated system prompt: `composeRecipeSpacePrompt(recipe)`:
     ```
     You run the recipe "${recipe.name}" in its own dedicated space.
     Your purpose: ${recipe.description}

     Follow these strict operational steps:
     ${recipe.sopInstructions}

     When your task is complete, produce your final structured result.
     You cannot call builtIn_useRecipe or builtIn_proposeRecipe.
     ```
   - Instantiates a clean conversation history array with only the task instruction.
2. **Restricted Tool Execution**:
   - The sub-agent only receives tools declared in `recipe.allowedTools`.
   - Tool calls execute through AIRI's existing `tool-bridge.ts`, but results remain local to the sub-agent context.
3. **Bounded Iteration**:
   - Execution is hard-capped at `recipe.maxTurns` (default 8) and a 120-second wall-clock timeout.
4. **Completion & Notice Injection**:
   - Once the sub-agent reaches a final answer, the recipe engine formats an asynchronous notice:
     ```
     [Notice from recipe:${recipe.name}, not a message from the owner.]
     The background task "${recipe.name}" finished.
     Result:
     ${resultText}
     [Speak about this notice only if it fits now, or stay quiet.]
     ```
   - This notice is appended to the companion's active grounding ledger. During the next conversational turn (or an immediate proactive heartbeat if priority is high), the companion naturally weaves the result into conversation.

---

## 5. UI Specification: `Settings > Recipes`

A dedicated settings view located at `packages/stage-pages/src/pages/settings/recipes/index.vue`:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  ⚙️ SETTINGS > RECIPES                                          [ + Create Recipe ]     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   [ Conversation Recipes ]      [ Auto-Run Recipes ]      [ Custom Authoring ]         │
│                                                                                        │
│   ┌─────────────────────────────────────────────────────────────────────────────┐      │
│   │ 📖 Daily Research Brief                                      🟢 Active     │      │
│   │ Purpose: Searches web for target topic, extracts key points, and logs to     │      │
│   │ Sacred Journal.                                                             │      │
│   │ Tools: web_search, text_journal_create | Max Turns: 6                        │      │
│   │ [ Edit SOP ]  [ Test Run in Sandbox ]  [ Duplicate ]  [ Delete ]            │      │
│   └─────────────────────────────────────────────────────────────────────────────┘      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐      │
│   │ 🖥️ Desktop Workspace Clean                                  🟢 Active     │      │
│   │ Purpose: Inspects open windows via AUV, snaps layout, and organizes tabs.    │      │
│   │ Tools: computer_use, spark_command | Max Turns: 8                           │      │
│   │ [ Edit SOP ]  [ Test Run in Sandbox ]  [ Duplicate ]  [ Delete ]            │      │
│   └─────────────────────────────────────────────────────────────────────────────┘      │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Architecture Seams & Integration Checklist

| Layer | Source Anchor | Responsibility |
| :--- | :--- | :--- |
| **Recipe Store** | `packages/stage-ui/src/stores/recipes.ts` | Maintains active recipes, manages background task sessions, enforces turn limits. |
| **Repository** | `packages/stage-ui/src/database/repos/recipes.repo.ts` | Unstorage persistence under `local:recipes/*`. |
| **Workstation Bridge** | `packages/stage-ui/src/libs/sandbox/manager.ts` | Registers `recipe` CLI binary and `customRequire('recipe')`. |
| **Chat Seam** | `packages/stage-ui/src/stores/chat.ts` | Ingests recipe completion notices and exposes `builtIn_useRecipe`. |
| **System-1 Dispatch** | `packages/stage-ui/src/stores/modules/system-one.ts` | Gating classifier integration for zero-token task launch. |
| **Settings UI** | `packages/stage-pages/src/pages/settings/recipes/` | Recipe catalog, SOP editor, and sandbox runner testbed. |

---

## 7. Verification & Safety Safeguards

1. **Infinite Loop Protection**: `maxTurns` prevents sub-agents from entering endless retry cycles.
2. **Zero History Contamination**: Sub-agent tool executions must **never** write directly to `chat-sessions.repo`.
3. **Sacred Journal Conformance**: When recipes call `text_journal_create`, entries follow standard append-only rules with explicit `source: "recipe:<name>"` metadata.
4. **Verification Suites**:
   - `pnpm -F @proj-airi/stage-ui test run src/stores/recipes.test.ts`
   - `pnpm -F @proj-airi/stage-ui typecheck`
