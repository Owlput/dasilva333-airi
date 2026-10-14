---
name: airi-sandbox-virtual-workstation
description: >-
  Build/debug the in-memory POSIX virtual terminal and RAM disk (/workspace):
  just-bash execution, VFS state projections, Node runtime customRequire shims
  (fs, path, mcp, jev), tsc-rs compiler bridge, and CLI toolchain. Generative UI
  widgets use airi-generative-widgets; System-1 classification policy uses
  airi-jev-decision-engine.
---

# In-Memory POSIX Virtual Workstation & Sandbox Terminal

Guidelines and architectural invariants for AIRI's in-memory virtual workstation, POSIX shell terminal (`just-bash` + WebAssembly), and RAM disk filesystem (`/workspace`). This system allows characters and coding agents to author code, inspect system telemetry, query fast System-1 decisions, and mount interactive Generative UI widgets in an isolated, secure in-memory sandbox without direct host OS execution.

---

## 1. The Interlocking Subsystem Trio

The virtual workstation operates as the foundation of an interlocking trio of capabilities:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               THE INTERLOCKING TRIO                                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   1. airi-sandbox-virtual-workstation (This Skill)                                     │
│   • POSIX virtual terminal (just-bash WebAssembly) & /workspace RAM disk               │
│   • Ambient state projections in /workspace/.airi/                                     │
│   • In-memory Node.js runtime (runNodeCode, customRequire)                             │
│   • CLI toolchain: mount_widget, unmount_widget, mcp, jev, coreutils                   │
│                                │                                                       │
│                 ┌──────────────┴──────────────┐                                        │
│                 ▼                             ▼                                        │
│   2. airi-generative-widgets    3. airi-jev-decision-engine                            │
│   • Iframe micro-apps           • Fast System-1 discrete classification (~100-150ms)   │
│   • AiriWidgetContext contract  • 32K context ModernBERT / OpenRouter decisions        │
│   • Multi-surface rendering:    • Semantic shell CLI: 'jev is', 'jev choose'           │
│     panel, widget, floating     • Native MCP tools: jev::choose, jev::is, jev::score   │
│   • Sidecar JSON state sync     • Memory query triage (c1_multihop..c4_literal)        │
│                                                                                        │
│                 ▲                             ▲                                        │
│                 └──────────────┬──────────────┘                                        │
│                                │                                                       │
│   Universal MCP Bridge (packages/stage-ui/src/libs/sandbox/mcp-bridge.ts)              │
│   • Routes airi.mcp.callTool() from widget iframes directly to Jev or external MCP     │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- When widgets or sandbox scripts need UI manifestation, see [airi-generative-widgets](../airi-generative-widgets/SKILL.md).
- When scripts or widgets need discrete decisions or classification, see [airi-jev-decision-engine](../airi-jev-decision-engine/SKILL.md).

---

## 2. Source Map & Canonical Anchors

Paths are repository-relative to `airi_dasilva333/`.

| Responsibility | Source and Anchor |
| --- | --- |
| Sandbox Manager & POSIX Shell | `packages/stage-ui/src/libs/sandbox/manager.ts` — `SandboxManager`, `exec()`, `init()`, CLI handlers |
| VFS State Projections | `packages/stage-ui/src/libs/sandbox/projections.ts` — `syncProjections()`, `/workspace/.airi/` |
| TypeScript Compiler Bridge | `packages/stage-ui/src/libs/sandbox/compiler-bridge.ts` — `compileTypeScript()`, `tsc-rs` vs Sucrase AST |
| Universal MCP Dispatcher | `packages/stage-ui/src/libs/sandbox/mcp-bridge.ts` — `executeUniversalMcpTool()`, `handleWidgetMcpMessage()`, `listUniversalMcpTools()` |
| Jev Semantic Bridge & Tools | `packages/stage-ui/src/libs/sandbox/jev.ts` — `createVirtualJevEnvironment()`, `executeJevMcpTool()`, `isJevMcpTool()`, `getJevMcpToolDescriptors()` |
| Sandbox Vitest Suites | `packages/stage-ui/src/libs/sandbox/sandbox.test.ts` & `mcp-bridge.test.ts` |
| Ambient Type Definitions | Seeded at `/workspace/types/airi-widget.d.ts` in virtual RAM disk |
| Widget Registry Repository | `packages/stage-ui/src/database/repos/widgets.repo.ts` (`local:widgets/registry`) |
| Canonical RFC Specification | `docs/proposal-in-memory-sandboxes-and-edge-wasm.md` |
| Status Report & Architecture | `docs/project-widget-system-status-report.md` |

---

## 3. Core Architectural Invariants

### A. Ephemeral RAM Disk Isolation
- `/workspace` is a completely isolated, in-memory virtual file system managed by `just-bash`.
- Files written to `/workspace` (e.g. via `cat > file`, `fs.writeFileSync`) do **not** touch the user's host OS filesystem.
- When an agent or user mounts a widget (`mount_widget <path>`), its code and metadata are persisted into `widgetsRepo` (`local:widgets/registry`) and sidecar state is synced into `/workspace/<name>.json`.

### B. Ambient State Projections (`/workspace/.airi/`)
The sandbox automatically maintains a debounced, one-way mirror of live AIRI runtime state:
- `/workspace/.airi/session.json`: Character ID, universe, session title, and timestamps.
- `/workspace/.airi/cognition.json`: Active cognitive state, mood, attention level, and nan0 somatic states.
- `/workspace/.airi/telemetry.json`: System metrics, FPS, device capability, and platform info.
- `/workspace/.airi/messages.json`: Recent conversation turns, preserving raw tokens (`<|ACTOR:...|>`, cues).

Scripts can query these directly using POSIX utilities:
```bash
cat /workspace/.airi/telemetry.json | jq .fps
cat /workspace/.airi/messages.json | jq '.[-1].content'
```

### C. In-Memory Node.js Runtime (`runNodeCode`)
- Executes scripts passed via `node -e "..."` or `node script.js`.
- Implements `customRequire` supporting:
  - `fs`: Synchronous/asynchronous VFS operations (`readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`).
  - `path`: Standard path manipulation utilities (`join`, `resolve`, `dirname`, `basename`, `extname`).
  - `mcp`: MCP tool calling (`mcp.callTool(name, args)`).
  - `jev` / `node:jev`: Fast System-1 classification API (`choose`, `is`, `score`, `triage`, `decide`).
- Injects global helpers: `globalThis.fs`, `globalThis.path`, `globalThis.mcp`, `globalThis.jev`.
- Supports ESM static imports, dynamic `import()`, top-level `await`, and `process.exit(code)`.

### D. Subshell Execution & Process Lifecycle
- Background commands run via standard POSIX subshell syntax: `command &`.
- Background tasks are session-bound and scoped strictly to the in-memory window lifecycle.
- **There is NO host OS daemon supervisor**: When the user reloads the page or restarts the desktop app, running background subshells terminate. State that needs durability must be saved to files in `/workspace` or persisted via `widgetsRepo`.

### E. Unified MCP Dispatcher Architecture
- All widget iframes post `mcp-call` messages to their host container.
- All three hosting surfaces ([`Generative.vue`](file:///Users/richardpinedo/Projects.nosync/airi/apps/stage-tamagotchi/src/renderer/widgets/generative/components/Generative.vue), [`FloatingWidgetCard.vue`](file:///Users/richardpinedo/Projects.nosync/airi/packages/stage-ui/src/components/scenarios/widgets/FloatingWidgetCard.vue), and [`ChatWorkspaceWidgetsPanel.vue`](file:///Users/richardpinedo/Projects.nosync/airi/packages/stage-ui/src/components/scenarios/chat/ChatWorkspaceWidgetsPanel.vue)) delegate message handling to `handleWidgetMcpMessage(e)`.
- `executeUniversalMcpTool(payload)` routes calls:
  1. If `isJevMcpTool(payload.name)` (`jev::choose`, `jev::is`, `jev::score`, `jev::triage`, `jev::decide`), it executes natively via the System-1 engine without requiring an external MCP session.
  2. Otherwise, it delegates to `tryGetMcpToolBridge().callTool(payload)`.
- In Web runtimes, `WebMcpClient.callTool()` also intercepts Jev tools so direct callers never fail with missing session errors.

---

## 4. Verification & Testing

When modifying the virtual workstation or sandbox bridges, run the dedicated test suites:

```bash
# 1. Run unit test suites
pnpm -F @proj-airi/stage-ui test run src/libs/sandbox/mcp-bridge.test.ts
pnpm -F @proj-airi/stage-ui test run src/libs/sandbox/sandbox.test.ts

# 2. Typecheck stage-ui and desktop/web surfaces
pnpm -F @proj-airi/stage-ui typecheck
pnpm -F @proj-airi/stage-tamagotchi run typecheck:web
```
