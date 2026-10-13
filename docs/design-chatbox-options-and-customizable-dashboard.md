# Design Specification: Nested Chat Options Popover & Customizable Dashboard

## 1. Overview & Architectural Goals

The desktop chat interface (`apps/stage-tamagotchi/src/renderer/pages/chat.vue`) is evolving into a modular conversation workstation. Over recent iterations, two major UI subsystems have expanded the chat experience:

1. **Nested Chat Options Popover (`ChatOptionsPopover.vue`)**:
   AIRI's first hierarchical popover replacing flat option menus with structured subviews, animated slide transitions, visual particle atmosphere previews, and embedded dynamic color theming.
2. **Customizable Dashboard Panel (Right Context Drawer)**:
   A redesign transforming the hardcoded right inspector in `chat.vue` into an arrangeable, modular panel supporting drag-and-drop reordering, visibility toggling, module availability gating, and persistent user customization.

---

## 2. Subsystem 1: Hierarchical Chat Options Popover

### 2.1 File Location & Cross-Surface Mount Points
- **Component**: `packages/stage-layouts/src/components/Layouts/ChatOptionsPopover.vue`
- **Export**: `@proj-airi/stage-layouts` (`ChatOptionsPopover`)
- **Mount Surfaces**:
  - Desktop Chatbox (`apps/stage-tamagotchi/src/renderer/pages/chat.vue#L1520`) via dots trigger (`triggerVariant="dots"`).
  - Mobile Stage Header (`packages/stage-layouts/src/components/Layouts/MobileUtilityPopover.vue`) via circle trigger (`triggerVariant="circle"`).

### 2.2 Navigation Model & State Hierarchy
The popover uses a strict `currentView: ChatOptionsView` state machine:
```ts
type ChatOptionsView = 'root' | 'capabilities' | 'tools' | 'injections' | 'appearance'
```

- When closed, `isOpen` watcher automatically resets `currentView` back to `'root'`.
- Subviews navigate back to root via the header button (`< Chat options`), which uses `i-solar:alt-arrow-left-linear`.
- The popover content uses a slide/fade transition (`<Transition mode="out-in">`):
  - Enter: `opacity-0 translate-x-2` → `opacity-100 translate-x-0` (200ms ease-out)
  - Leave: `opacity-100 translate-x-0` → `opacity-0 -translate-x-2` (150ms ease-in)

### 2.3 Subview Responsibilities
| View ID | Title Key | Contents |
| :--- | :--- | :--- |
| `root` | `Chat options` | 4 categorized entry cards with glyphs + descriptions; bottom Chat Layout radio selector (`mini` \| `medium` \| `large` \| `full`). |
| `capabilities` | `Core Capabilities` | Live toggles for Screen Watching, Dream State, and Autonomous Artistry / Visual Novel generation. |
| `tools` | `Tools & Workstation` | Built-in and MCP tool execution switches (Text Journal, Stickers, Generative Widgets, Dating Sim, etc.). |
| `injections` | `Prompt Injections` | Dynamic prompt layer controls (Recent Topics, Salience Gate, Director Guidance, Pinned Context). |
| `appearance` | *(Empty in bar; banner inside)* | Atmosphere particle selector, wallpaper scene gallery, and theme/accent palette widget. |

### 2.4 Appearance Subview Architecture
1. **Appearance Header Banner**:
   A horizontal banner containing the Magic Stick icon (`bg-amber-500/10 text-amber-500`), title/subtitle, and right-aligned `<SettingsThemeHeaderWidget shrink-0 />`.
2. **Embedded Theme & Palette Widget (`SettingsThemeHeaderWidget.vue`)**:
   - Toggle button cycling Dark / Light mode with `i-solar:moon-bold-duotone` and `i-solar:sun-2-bold-duotone`.
   - Popover swatch trigger displaying the active primary hue.
   - Popover portal (`z-[10050]`) rendering the **Accent Palette** flyout:
     - 24-color preset grid (4 rows × 6 columns) spanning *Warm & Fire*, *Earth & Flora*, *Ocean & Sky*, and *Royal & Bloom*.
     - Amber-bordered Reset button restoring `--chromatic-hue` to default (`220.44`).
3. **Atmosphere 3-Column Visual Grid**:
   - 6 particle patterns: `Hearts`, `Sakura`, `Anime Stars`, `Dreamy Bubbles`, `Cyber Crosses`, `Melody`.
   - Each pattern component accepts `preview?: boolean` and `transparent-bg?: boolean` props, throttling particle counts from 30+ down to 6–8 and reducing canvas resize allocations for lightweight concurrent rendering.
   - Active indicator badge with `i-solar:check-circle-bold`.
   - "Clear effect" action button resetting atmosphere to `'none'`.
4. **Wallpaper Gallery & Crossfades**:
   - Quick 6-scene thumbnail grid with active checkmark badge.
   - "Browse all scenes" trigger opening `StageBackgroundDialogPicker`.
   - Active wallpaper changes update `backgroundStore.setChatboxActiveBackground()`.
   - `apps/stage-tamagotchi/src/renderer/pages/chat.vue` handles smooth 700ms GPU-accelerated crossfades (`will-change-opacity`) between scenes without frame drops.

---

## 3. Subsystem 2: Customizable Dashboard Panel

### 3.1 Motivation & Problem Statement
Currently, the right sidebar in `apps/stage-tamagotchi/src/renderer/pages/chat.vue` contains hardcoded sections:
- Memories
- Current Scene
- Media Gallery
- Widgets
- Virtual Terminal
- Nan0 Cognition (conditional)
- Stage Viewport (conditional)

Each section maintains an independent `useLocalStorage` boolean for collapsed state. Power features compete for vertical space, users cannot reorder cards to suit their workflows, and casual users cannot hide tools they do not use.

### 3.2 View Mode vs. Customize Mode Lifecycle
The panel exists in two distinct modes:

```
┌──────────────────────────────────────────────┐       Click Slider Icon / '+ Add Module'
│            RUNTIME VIEW (Mode: 'view')        │ ─────────────────────────────────────────────► ┌──────────────────────────────────────────────┐
│                                              │                                                 │          CUSTOMIZE VIEW (Mode: 'customize')  │
│  [::] Dashboard            [Sliders] [<]     │                                                 │                                              │
│                                              │ ◄─────────────────────────────────────────────  │  [::] Customize dashboard      [Done] [<]    │
│  ▼ Widgets (2)                               │              Click 'Done' / Header Back         │  "Drag to reorder. Hide what you don't use." │
│    • Arona's Strawberry                      │                                                 │                                              │
│    • Haven café timer                        │                                                 │  ON YOUR DASHBOARD (Active Reorderable)      │
│  ▼ Virtual Terminal                          │                                                 │  [::] [Icon] Widgets             [Eye/Hide]  │
│    $ cat /workspace/haven_cafe_stopwatch...  │                                                 │  === Insertion Indicator (Drop Zone) ======= │
│  ▼ Memories                         [+ New]  │                                                 │  [::] [Icon] Virtual Terminal    [Eye/Hide]  │
│                                              │                                                 │  [::] [Icon] Memories            [Eye/Hide]  │
│  + Add module                                │                                                 │                                              │
│                                              │                                                 │  AVAILABLE MODULES (Inactive Catalog)        │
│                                              │                                                 │  [Icon] Stage                        [+ Add] │
│                                              │                                                 │  [Icon] Current Scene                [+ Add] │
│                                              │                                                 │  [Icon] Media Gallery                [+ Add] │
│                                              │                                                 │                                              │
│                                              │                                                 │  [Restore default layout]                    │
└──────────────────────────────────────────────┘                                                 └──────────────────────────────────────────────┘
```

1. **Runtime View (`mode === 'view'`)**:
   - Normal operating mode.
   - Shows active modules in the user's saved order.
   - Each module header has a collapse chevron (`^` / `v`) toggling card body visibility.
   - Header contains the **tune / sliders button** (`i-solar:tuning-2-linear`); footer contains **`+ Add module`**. Both transition to Customize View.
2. **Customize View (`mode === 'customize'`)**:
   - Header shows "Customize dashboard" and a green **`Done`** button.
   - **"ON YOUR DASHBOARD"**: Shows active modules with drag handles (`::`), eye hide buttons, and visual drop-insertion indicators.
   - **"AVAILABLE MODULES"**: Shows inactive modules with `+ Add` buttons.
   - **"Restore default layout"**: Single click restores the baseline layout.
   - Clicking `Done` or `<` commits the layout and returns to Runtime View.

---

## 4. Architectural Boundaries: Modules vs. Widgets

A foundational design invariant is the **strict separation of Modules and Widgets**:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                DASHBOARD MODULES                                │
│       Chassis / Sidebar Sections (Managed by Dashboard Composable / Store)       │
├────────────────────┬────────────────────┬───────────────────┬───────────────────┤
│   'widgets'        │   'terminal'       │   'memories'      │   'media', etc.   │
└─────────┬──────────┴────────────────────┴───────────────────┴───────────────────┘
          │ (hosts content)
          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            SANDBOX GENERATIVE WIDGETS                           │
│        Interactive Micro-Apps (Managed by useSandbox & widgetsRepo)             │
├─────────────────────────────────────────┬───────────────────────────────────────┤
│   • Arona's Strawberry (Pet micro-app)  │   • Haven café timer (Stopwatch app)  │
│   • Runs in sandboxed iframe (srcdoc)   │   • Subscribes to sidecar telemetry   │
│   • Persisted in local:widgets/registry │   • Syncs state with POSIX workspace  │
└─────────────────────────────────────────┴───────────────────────────────────────┘
```

### 4.1 Boundary Responsibilities
- **Dashboard Modules**:
  - Own the sidebar layout chassis, ordering, drag-and-drop, and section collapse state.
  - Are native Vue system components (`ChatWorkspaceWidgetsPanel`, `ChatWorkspaceTerminalPanel`, etc.).
  - Have full access to Pinia stores, Electron IPC, and application context.
- **Sandbox Widgets**:
  - Are dynamic micro-apps authored in `/workspace` by the user or agent.
  - Are compiled via `tsc-rs` or Sucrase and executed in sandboxed iframes via `buildWidgetIframeSrcdoc()`.
  - Are managed by `useSandbox()` and persisted in `widgetsRepo` (`local:widgets/registry`).
- **Conclusion**:
  Dashboard customization must never tamper with `widgetsRepo`. The `widgets` dashboard module simply serves as the host viewport for mounted sandbox widgets.

---

## 5. State Management & Persistence (`useChatDashboard`)

### 5.1 Persisted Schema (`airi:chat:dashboard-layout`)
The dashboard layout is persisted in `localStorage` under `airi:chat:dashboard-layout`:

```ts
export type DashboardModuleId
  = | 'widgets'
    | 'terminal'
    | 'memories'
    | 'stage'
    | 'scene'
    | 'media'
    | 'nan0'

export interface DashboardLayoutState {
  version: number // Schema version, currently 1
  activeModuleIds: DashboardModuleId[] // User's ordered active modules
  collapsedStates: Record<DashboardModuleId, boolean> // Collapsed states per module
}
```

### 5.2 Legacy Preference Migration
`pages/chat.vue` historically used individual `useLocalStorage` keys:
- `airi:chat:rp-memories-collapsed`
- `airi:chat:rp-current-scene-collapsed`
- `airi:chat:rp-media-collapsed`
- `airi:chat:rp-terminal-collapsed`
- `airi:chat:rp-widgets-collapsed`
- `airi:chat:rp-nan0-collapsed`
- `airi:chat:rp-stage-collapsed`

**Migration Rule**:
When initializing `useChatDashboard()`, if `airi:chat:dashboard-layout` does not exist:
1. Inspect legacy keys and seed `collapsedStates` with their existing boolean values.
2. Determine active modules based on legacy states (e.g., modules that were not collapsed or present).
3. Write the initialized `DashboardLayoutState` with `version: 1`.
4. Retain legacy keys for backwards compatibility or gracefully sunset them.

### 5.3 Availability vs. Visibility Decoupling
Module **Availability** is distinct from Module **Visibility**:
- `isSandboxActive` controls availability of `'widgets'` and `'terminal'`.
- Character `cognition` config controls availability of `'nan0'`.
- Separate stage window visibility controls availability of `'stage'`.

**Invariant**:
If a module is temporarily **unavailable** (e.g., sandbox is disabled for this session), it is hidden from the live render, but its position in `activeModuleIds` **remains preserved**. When the user re-enables sandbox, the module reappears in its exact chosen slot without resetting user customization.

### 5.4 Code-Only Module Registry
Persisted state contains only IDs, order, collapse booleans, and schema version. The static module catalog lives strictly in code:

```ts
export interface DashboardModuleDefinition {
  id: DashboardModuleId
  titleKey: string
  defaultTitle: string
  descriptionKey: string
  defaultDescription: string
  icon: string
  component: Component
  isAvailable?: () => boolean
  badge?: () => string | number | undefined
}
```

### 5.5 Component Lifecycle & Stable Key Invariants
- **Iframe Preservation**: `ChatWorkspaceWidgetsPanel` mounts sandboxed iframes and establishes window message listeners. Switching into Customize View or reordering cards must **not** destroy or reload running iframes.
- **Rendering Strategy**:
  - Modules render in a `v-for="mod in visibleActiveModules"` loop keyed by stable `:key="mod.id"`.
  - Reordering shifts array indexes; Vue's virtual DOM preserves component instances under stable keys.
  - Customize View renders the catalog editor in a lightweight overlay or secondary tab while preserving the host components.
- **Accessibility**: Alongside drag-and-drop, every module card in Customize View provides keyboard-accessible `Move Up` and `Move Down` actions (`Alt+Up` / `Alt+Down` or button clicks).

---

## 6. Implementation Roadmap

### Phase 1: Nested Popover Polish (Shipped)
- [x] Hierarchical navigation in `ChatOptionsPopover.vue` (`currentView` state machine).
- [x] Smooth `<Transition mode="out-in">` sliding navigation.
- [x] Mini-particle preview canvases in Appearance subview.
- [x] Wallpaper scene selection with 700ms GPU crossfades in `chat.vue`.
- [x] Embedded `SettingsThemeHeaderWidget` with 24-color preset popover.

### Phase 2: Dashboard State & Composable Foundation
- [ ] Create `packages/stage-ui/src/composables/use-chat-dashboard.ts`.
- [ ] Implement `DashboardLayoutState` schema and legacy preference migration.
- [ ] Implement normalization (stale ID pruning, duplicate deduplication, fallback defaults).
- [ ] Decouple module availability gates (`isSandboxActive`, `nan0Cognition`).

### Phase 3: Dashboard UI & Customize Mode
- [ ] Create `ChatDashboardPanel.vue` (Runtime View) replacing hardcoded sections in `chat.vue`.
- [ ] Create `ChatDashboardCustomizer.vue` (Customize View) with drag reorder, eye hide toggles, and `Restore default layout`.
- [ ] Integrate SortableJS / `useSortable` with accessible keyboard fallbacks.
- [ ] Verify zero-unmount iframe preservation during reorder.
