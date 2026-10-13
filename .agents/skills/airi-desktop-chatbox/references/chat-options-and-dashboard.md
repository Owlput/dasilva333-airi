# Chat Options & Customizable Dashboard

## Overview & Ownership

- **Chat Options Popover**: `packages/stage-layouts/src/components/Layouts/ChatOptionsPopover.vue` (exported as `ChatOptionsPopover` from `@proj-airi/stage-layouts`).
  - Desktop trigger: `pages/chat.vue` (`triggerVariant="dots"`).
  - Mobile header trigger: `packages/stage-layouts/src/components/Layouts/MobileUtilityPopover.vue` (`triggerVariant="circle"`).
- **Dashboard Context Panel**: Right panel in `apps/stage-tamagotchi/src/renderer/pages/chat.vue`.
  - State manager: `useChatDashboard()` (persisted in `localStorage` key `airi:chat:dashboard-layout`).
  - Active modules: `Widgets`, `Virtual Terminal`, `Memories`, `Stage`, `Current Scene`, `Media Gallery`, `Nan0 Cognition`.

---

## 1. Chat Options Popover (`ChatOptionsPopover.vue`)

### Navigation State Machine
```ts
type ChatOptionsView = 'root' | 'capabilities' | 'tools' | 'injections' | 'appearance'
```
- Closing the popover resets `currentView` to `'root'`.
- Horizontal subview navigation uses `<Transition mode="out-in">` with 200ms ease-out enter and 150ms ease-in leave.
- Back button (`< Chat options`) returns to `'root'`.

### Appearance Subview Structure
- **Theme Widget**: `<SettingsThemeHeaderWidget shrink-0 />` embedded in the header banner. Controls dark/light mode and 24-color preset primary accent popover (`z-[10050]`).
- **Atmosphere Visual Cards**: 3-column grid rendering mini-particle preview canvases (`Hearts`, `Sakura`, `Stars`, `Bubbles`, `Crosses`, `Melody`).
  - Each pattern component accepts `preview?: boolean` and `transparent-bg?: boolean` to run a lightweight, throttled simulation (6–8 particles) suitable for multi-canvas rendering.
- **Wallpaper Gallery**: Quick thumbnail grid + "Browse all scenes" (`StageBackgroundDialogPicker`).
  - Changes dispatch to `backgroundStore.setChatboxActiveBackground()`.
  - `pages/chat.vue` crossfades background changes with 700ms GPU transitions (`will-change-opacity`).

---

## 2. Dashboard Panel Architecture

### View Mode vs. Customize Mode
- **View Mode (`mode === 'view'`)**: Normal runtime view rendering active modules in user-defined order with accordion collapse chevrons (`^`/`v`).
- **Customize Mode (`mode === 'customize'`)**: Edit mode with drag-and-drop reordering, eye hide buttons, "AVAILABLE MODULES" add catalog, and "Restore default layout".
- **Trigger**: Click sliders button (`i-solar:tuning-2-linear`) or `+ Add module` to enter customize mode. Click `Done` or `<` to exit.

### Boundary: Modules vs. Sandbox Widgets
- **Dashboard Modules**: Own the sidebar layout chassis and arrangement. They are native Vue components with store access.
- **Sandbox Widgets**: Micro-apps running in iframes authored in `/workspace` managed by `useSandbox()` and persisted in `widgetsRepo` (`local:widgets/registry`).
- The `Widgets` dashboard module simply acts as the viewport container for active sandbox widgets. Customizing dashboard layout does not alter `widgetsRepo`.

### Persistence & Invariants
- **Persisted Schema**:
  ```ts
  interface DashboardLayoutState {
    version: number
    activeModuleIds: DashboardModuleId[]
    collapsedStates: Record<DashboardModuleId, boolean>
  }
  ```
  Persist IDs, order, and collapse booleans only. Metadata, icons, titles, and components remain in code.
- **Legacy Migration**: Migrate existing `airi:chat:rp-*-collapsed` localStorage values on first run.
- **Availability Decoupling**: If a module is unavailable (e.g. sandbox disabled, character lacks cognition), hide it from render but keep its slot in `activeModuleIds` so the user's saved order is never destroyed.
- **Lifecycle Guarantees**: Use stable `:key="module.id"` so reordering does not unmount or reload running widget iframes.

---

## Verification

1. **Popover**: Navigate into each subview (`capabilities`, `tools`, `injections`, `appearance`), verify slide transition, test atmosphere selection, toggle dark/light mode, pick a color swatch, and verify popup closes properly.
2. **Dashboard**: Test reordering modules, collapsing cards, hiding/showing via customize mode, toggling sandbox availability, and refreshing page to ensure layout persists.
3. **Typecheck**: Run `pnpm -F @proj-airi/stage-layouts typecheck` and `pnpm -F @proj-airi/stage-tamagotchi typecheck`.
