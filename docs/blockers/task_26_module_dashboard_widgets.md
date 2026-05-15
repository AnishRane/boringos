# Task 26 — Module dashboard widgets

> Add a sixth `PluginUI` extension surface so installed Modules can
> contribute widgets to the shell Home screen. Today the dashboard
> is a fixed layout of framework-level KPI tiles + a cost sparkline
> + the operating pulse — Modules cannot surface anything on it.
> CRM, Drive, Inbox, and any future Module is invisible on the page
> the user opens first.

---

## Status

| Field | Value |
|---|---|
| **State** | LANDED — A + B + C shipped, typecheck + build clean |
| **Owner** | parag |
| **Started** | 2026-05-15 |
| **Last updated** | 2026-05-15 |
| **Estimated effort** | ~1 dev-day end-to-end (contract + host + Home wiring + one real CRM widget as proof) |
| **Prerequisites** | Task 21 (one module system) landed. The `pluginHost` runtime + `PluginUI` contract from task_19/task_21 are the foundation this task extends |
| **Related** | Task 21 §3.1 notes the old `@boringos/app-sdk` defined `DashboardWidget` and Task 21 / Phase I §"LANDED with honest deferrals" explicitly **deferred** dashboard extensibility ("Shell's slot system has too much integration with primitive components — clean detachment requires per-component rewrites"). This task is the per-component rewrite for Home. |

---

## 1. The principle

A Module is supposed to be a complete, self-contained unit of
behaviour + UI. Today a Module can contribute to five shell
surfaces: sidebar nav, entity detail panels, entity actions,
settings panels, inbox filters. The Home screen — the first thing
the user sees after login, the page that should answer "what's
going on across my stack?" — is the only major surface that
**cannot** be extended.

The result is a structural lie: the shell looks composable, but
Home is hand-curated framework UI. A user with CRM installed
opens Home and sees no deal pipeline, no follow-ups due, no
recent activity. A user with Drive installed sees no recent
documents. The page is generic by construction, regardless of
what the tenant has installed.

The principle: **Home is a registry, not a layout.** Modules
declare widgets, the shell composes them. The framework's existing
tiles (Open work, Agents online, Unread inbox, Pending approvals,
Cost sparkline, Operating pulse, Watch items) get re-expressed as
contributions from the framework's own built-in Modules — same
mechanism, same surface, no privileged path. After this task,
adding a new top-level dashboard tile is a Module change, not a
shell change.

## 2. Today's reality, in detail

### 2.1 Where Home is rendered

`packages/@boringos/shell/src/screens/Home.tsx` (~252 lines). The
file imports six framework hooks directly:

```ts
import {
  useAgents, useCosts, useInbox,
  useRoutines, useTasks, useWorkflows,
} from "@boringos/ui";
```

…and renders a hand-coded JSX tree:

- 4 `<StatTile>` instances (open work, agents online, unread
  inbox, pending approvals)
- 1 `<CostSparkline>` (8-week bucket reduction over `useCosts()`)
- 1 `<OperatingPulse>` (today's routines + workflow + agent
  counts)
- 1 watch-items list (filter on `useTasks()` by priority)

There is no `pluginHost.dashboard*` lookup anywhere in the file.
Every section is hardcoded and consumes framework hooks
directly. No prop drilling, no slots, no registry.

### 2.2 What the plugin contract currently exposes

`packages/@boringos/ui/src/contract.ts` — the canonical `PluginUI`
shape — declares six contribution arrays:

```ts
export interface PluginUI {
  moduleId: string;
  displayName?: string;
  navItems?: NavItem[];
  entityPanels?: EntityPanel[];
  entityActions?: EntityAction[];
  settingsPanels?: SettingsPanel[];
  copilotTools?: CopilotTool[];
  inboxFilters?: InboxFilter[];
}
```

No `dashboardWidgets`. No `homeWidgets`. No precedent on the page.

### 2.3 What the registry exposes

`packages/@boringos/shell/src/plugin-host/registry.ts` — the
in-memory `PluginHost` — provides five query surfaces:
`navItems`, `entityPanelsFor(kind)`, `entityActionsFor(kind)`,
`settingsPanels`, `copilotTools`, `inboxFilters`. No dashboard
query method.

### 2.4 What gets installed today

Module install/uninstall already round-trips through
`pluginHost.register(ui)` and `pluginHost.unregister(id)`,
notifying subscribers via the `useSyncExternalStore`-shaped
hook (`getSnapshot` flips on every change). The sidebar
re-renders in <1s when a Module is installed — this is the
plumbing we want Home to ride on for free.

### 2.5 The history (why this hasn't shipped already)

Task_21 / Phase I status entry on 2026-05-10:

> Phase I attempted nuclear delete of @boringos/{app-sdk,…}. Shell's
> slot system has too much integration with primitive components
> (Sidebar, Settings, **Home**, CommandBar) — clean detachment
> requires per-component rewrites. Restored those packages …
> kept all the non-destructive user-visible renames.

The v1 `@boringos/app-sdk` once defined a `DashboardWidget`
interface (`task_21.md` §3.1 inventory). It was deleted with the
rest of v1 because nothing consumed it on the v2 surface. This
task adds it back, but on the v2 / Module surface, with a real
consumer (Home.tsx) wired up the same day.

## 3. Target architecture

After this task ships:

A Module author exports widgets the same way they export nav
items today:

```ts
export const crmUI: PluginUI = {
  moduleId: "crm",
  displayName: "CRM",
  navItems: [/* … */],
  dashboardWidgets: [
    {
      id: "deals-closing-this-week",
      title: "Closing this week",
      size: "small",       // "small" | "medium" | "large"
      slot: "primary",     // "primary" | "secondary" (initial split)
      element: lazy(() => import("./widgets/DealsClosingThisWeek.js")),
      order: 200,
    },
    {
      id: "pipeline-by-stage",
      title: "Pipeline by stage",
      size: "medium",
      slot: "primary",
      element: lazy(() => import("./widgets/PipelineByStage.js")),
      order: 300,
    },
  ],
};
```

The widget component receives no props (or `{ moduleId }` only)
and is responsible for its own data fetching via the existing
`useTool` / `useToolMutation` / framework hooks. The shell wraps
each widget in:
- an error boundary (a widget crash never blacks out the page),
- a `<Suspense>` fallback (a skeleton tile while the lazy chunk
  loads),
- an install gate (widgets from uninstalled modules don't render —
  belt-and-braces; `pluginHost.unregister` already removes them
  on uninstall).

The framework's own KPI tiles + cost sparkline + operating pulse
+ watch items become contributions from a new built-in
`dashboard` Module (or are attached to existing built-in Modules
where the data lives — `framework` for KPI counts, `costs` for
the sparkline, `inbox` for unread, `workflow` for the operating
pulse). No widget gets a special path; Home iterates the
registry.

`Home.tsx` shrinks to ~40 lines: a header, a registry read, a
grid that lays out widgets by `slot` + `order` + `size`. No
hardcoded JSX trees.

## 4. Contract changes

### 4.1 New types in `@boringos/ui/src/contract.ts`

```ts
export type DashboardWidgetSize = "small" | "medium" | "large";
export type DashboardWidgetSlot = "primary" | "secondary";

export interface DashboardWidget {
  /** Stable id within the module's widget set. */
  id: string;
  /** Human label rendered in the widget header. Plain string. */
  title: string;
  /** Grid footprint. small = 1 col, medium = 2 cols, large = full row. */
  size: DashboardWidgetSize;
  /** Vertical placement bucket. Primary = above-the-fold. */
  slot: DashboardWidgetSlot;
  /** The component. No required props; if any, must be optional. */
  element: PluginElement;
  /** Sort hint within (slot, module). Lower first. Defaults to 100. */
  order?: number;
}

export interface PluginUI {
  // … existing fields …
  dashboardWidgets?: DashboardWidget[];
}
```

Keep the contract minimal in this pass. Things deliberately
**not** added in v1 of the surface (deferred to a follow-up
task if they turn out to matter):
- per-widget visibility predicates (use install gating instead)
- per-widget refresh hints (widgets own their own polling)
- user-pinned ordering / drag-rearrange (UX experiment, not a
  framework primitive)
- per-widget settings (settings live in the Module's
  `settingsPanels` surface; if a widget needs config, it links
  to that)

### 4.2 New registry method in `plugin-host/registry.ts`

```ts
export interface PluginHost {
  // … existing fields …
  /** All dashboard widgets, grouped by slot, sorted by (order, moduleId). */
  dashboardWidgets: Array<DashboardWidget & { moduleId: string }>;
}
```

Implementation mirrors `settingsPanels` — flatten every module's
contributions, attach `moduleId`, sort. The `useSyncExternalStore`
hook already exists; consumers re-render on register/unregister
without extra plumbing.

### 4.3 New consumer hook in `@boringos/ui/src/plugin-hooks.ts`

`useDashboardWidgets()` — returns the gated list (filtered by
`useInstalledModules()`). Same shape as the existing
`useSettingsPanels()` / `useNavItems()` hooks.

## 5. Phased workstream

Each phase is independently shippable, testable, revertable.
Phase A is contract-only — no UI change. Phase B is the Home
rewrite. Phase C is the proof: at least one Module (CRM)
contributes a real widget end-to-end.

### Phase A — Contract + host plumbing (no user-visible change)

A1. Add `DashboardWidget`, `DashboardWidgetSize`,
`DashboardWidgetSlot` to `@boringos/ui/src/contract.ts`; extend
`PluginUI` with the optional `dashboardWidgets` field.

A2. Add the `dashboardWidgets` getter on `PluginHost` in
`shell/src/plugin-host/registry.ts`. Sort by (slot, order,
moduleId).

A3. Add the `useDashboardWidgets()` hook in
`@boringos/ui/src/plugin-hooks.ts`. Apply the install-gating
filter (same pattern as `useNavItems`).

A4. Add a `DashboardWidgetGrid` primitive in
`shell/src/components/DashboardWidgetGrid.tsx` (or co-locate in
Home.tsx if it stays tiny). Renders a list of widgets, wraps
each in `<ErrorBoundary>` + `<Suspense>` with a skeleton
fallback. Handles size → grid-col mapping. **No widgets land
yet — this is the empty grid.**

Build + typecheck. ~2 hours.

### Phase B — Migrate Home's existing tiles to widgets

B1. Decide the home of the framework-shipped widgets. Two viable
options:

- **Option 1 (recommended):** Each existing built-in Module that
  owns the data ships its own widget. `framework` Module ships
  Open-work + Agents-online + Pending-approvals + Operating-pulse
  + Watch-items widgets. `inbox` Module ships Unread-inbox. A new
  `costs` Module (or attach to `framework`) ships the
  Cost-sparkline. This is the "no privileged path" version.
- **Option 2 (faster, less pure):** Add a single new `dashboard`
  Module under `packages/@boringos/core/src/modules/dashboard/`
  that ships every framework-shipped widget. Simpler to land,
  worse for the "Modules are uniform" thesis. **Pick option 1
  unless option 2 unblocks a deadline.**

B2. Move each existing Home section into a widget component
under the chosen Module's `widgets/` directory. Each widget keeps
its current data hooks (`useTasks`, `useAgents`, etc.) — no
data-fetching changes in this task.

B3. Rewrite `Home.tsx` to:
- render the header,
- call `useDashboardWidgets()`,
- render two `<DashboardWidgetGrid>` sections (primary slot
  above, secondary below) — or a single grid with a slot
  separator,
- nothing else.

B4. Sanity-check the page visually: same tiles, same data, same
order. If a layout regression surfaces, tune `order` values on
the contributed widgets — do not re-introduce hardcoded JSX.

Build + typecheck + manual smoke test. ~3 hours.

### Phase C — Ship one real third-party widget (CRM)

C1. In `boringos-crm/packages/web/src/ui.ts`, add a
`dashboardWidgets` entry to `crmUI` for "Deals closing this
week" (cheapest meaningful widget — uses the existing
`crm.deals.list` tool with a date filter).

C2. Build the widget component in
`boringos-crm/packages/web/src/dashboard/DealsClosingThisWeek.tsx`
— renders the count + the top 3 deals with a link to the deal
detail route the CRM already mounts.

C3. Bump the CRM module package version. Build the `.hebbsmod`
or rely on the local workspace wire-up.

C4. Install CRM end-to-end on a fresh tenant; verify:
- Home renders the new widget within ~1s of install
  (`useSyncExternalStore` snapshot flip).
- Uninstall CRM → widget disappears within ~1s.
- Re-install → widget reappears, no duplicates.

~3 hours.

### Phase D (optional, follow-up) — Second CRM widget + Drive

If C ships clean and time allows: add a "Pipeline by stage"
widget to CRM and a "Recent documents" widget to Drive. These
are purely demonstrative — they don't unlock new framework
behaviour. Defer to a separate task if Phase A–C took longer
than expected.

## 6. Acceptance criteria

The task is **done** when every one of these is true:

1. `PluginUI` in `@boringos/ui/src/contract.ts` declares a
   `dashboardWidgets?: DashboardWidget[]` field, and the
   `DashboardWidget` type is exported.
2. `pluginHost.dashboardWidgets` getter exists and returns every
   registered widget with its `moduleId` attached, sorted by
   `(slot, order, moduleId)`.
3. `useDashboardWidgets()` hook exists in `@boringos/ui` and
   filters by installed modules.
4. `Home.tsx` no longer imports `useTasks`/`useAgents`/etc.
   directly for layout purposes — it renders the registry,
   nothing else. The only framework hooks Home keeps are the
   ones needed for the page header (e.g., `useAuth`).
5. Every tile currently visible on Home (open work, agents
   online, unread, approvals, cost sparkline, operating pulse,
   watch items) is contributed by a Module via
   `dashboardWidgets`. The visual layout is unchanged for the
   default tenant (or differs only in pixel-perfect ways that
   don't affect information density).
6. CRM contributes at least one `dashboardWidget` ("Deals
   closing this week"). Installing CRM on a tenant adds the
   widget to Home within ~1s; uninstalling removes it within
   ~1s.
7. A widget that throws an error renders an inline error pill
   instead of blacking out the page (error boundary works).
8. A widget that suspends shows a skeleton tile, not a flash of
   nothing.
9. `pnpm -r typecheck` and `pnpm -r build` pass clean across the
   framework and CRM workspaces.
10. `BUILD-A-MODULE.md` documents the new surface with a
    minimal example.

## 7. Risks + mitigations

- **Risk:** a poorly-written widget blocks Home from rendering
  (sync throw, infinite render loop). **Mitigation:** every
  widget renders inside a per-widget `<ErrorBoundary>` + an
  `<Suspense>` boundary. A broken widget collapses to an error
  pill; the rest of the dashboard is unaffected.

- **Risk:** the page becomes a slow, jittery grid as N widgets
  fetch independently. **Mitigation:** widgets use the existing
  `useTool` / framework hooks which are already cached
  (React-Query under the hood for the `@boringos/ui` plugin
  hooks). No new fetch infrastructure is introduced. If
  perceived slowness shows up in testing, the answer is widget
  authors using cached hooks correctly — not adding a
  framework-level orchestrator.

- **Risk:** layout regressions when porting the existing tiles to
  widgets. **Mitigation:** Phase B includes a manual side-by-side
  visual check before merging. The widget surface supports `size`
  + `order` + `slot` — enough to reproduce the current layout.

- **Risk:** dashboard becomes a dumping ground (every Module
  ships 5 widgets, page becomes a soup). **Mitigation:** out of
  scope for this task — it's a UX governance problem, not a
  framework problem. If it surfaces in practice, follow-up tasks
  can add: per-tenant "show/hide widget" toggles, a "max
  widgets per module" guideline in BUILD-A-MODULE.md, or a
  per-user widget preference. None of those block this task.

- **Risk:** the new contract field overlaps semantically with
  some future "module home screen" / "module landing page"
  concept. **Mitigation:** keep the name `dashboardWidgets`
  scoped to *the shell Home screen*. A Module's own landing
  page (if one ever exists) is a different surface, contributed
  through a different field. Reserve `homePage` / `landing`
  names for that future case.

- **Risk:** porting framework tiles into a "framework" Module
  bloats that Module's manifest. **Mitigation:** widgets are
  small and co-located by purpose. If `framework` Module grows
  past ~5 widgets, split into a dedicated `dashboard` Module
  (Phase B option 2 fallback).

## 8. Order of operations

```
A → B → C → (optional D)
```

Phase A is risk-free and unlocks downstream work. Phase B is the
visible cleanup but doesn't user-facing-change anything if done
right (same tiles, same data). Phase C is where the user feels
the win: CRM appearing on Home for the first time.

## 9. What does not change

- The `Module` server-side manifest (`@boringos/module-sdk`) — no
  new fields. Widgets are UI-only; they live in `PluginUI`.
- The install/uninstall pipeline, the install-manager, the
  `.hebbsmod` bundle format, the realtime install events — all
  reused as-is. Adding a widget to a Module bumps that Module's
  version like any other UI change.
- Sidebar, Settings, entity panels, command palette — untouched.
- The plugin host's existing surfaces (`navItems`, `entityPanels`,
  etc.) — untouched.
- The CRM's existing surfaces (Pipeline, Deals, Contacts,
  Companies routes + entity panels + entity actions + settings
  panels) — untouched. The new widget is additive.

## 10. References

- `docs/blockers/task_21_one_module_system.md` §3.1 (the original
  `DashboardWidget` interface in the dead v1 SDK) and §"Phase I
  LANDED with honest deferrals" — explains why this surface
  doesn't exist today.
- `packages/@boringos/ui/src/contract.ts` — the `PluginUI`
  contract this task extends.
- `packages/@boringos/shell/src/plugin-host/registry.ts` — the
  registry this task adds a getter to.
- `packages/@boringos/shell/src/screens/Home.tsx` — the file this
  task rewrites.
- `boringos-crm/packages/web/src/ui.ts` — the CRM
  `PluginUI` declaration that gets the first
  `dashboardWidgets` entry in Phase C.
- `BUILD-A-MODULE.md` — to be updated in the same PR as Phase A.

## 11. Status log

| Date | Phase | Status | Notes |
|---|---|---|---|
| 2026-05-15 | C | LANDED | CRM contributes `deals-closing-this-week` widget (secondary slot, small). Uses `crm.deals.list` + client-side 7-day filter. Links to deal detail. `pnpm -r build` clean for framework + CRM workspaces. |
| 2026-05-15 | B | LANDED | Home.tsx now ~25 lines: header + `<DashboardWidgetGrid widgets={useDashboardWidgets()} />`. Framework KPI tiles + cost sparkline + operating pulse + watch items extracted into per-widget components under `shell/src/builtin-plugins/widgets/`, registered as `framework` PluginUI. Unread inbox extracted under `inbox` PluginUI. `registerBuiltinPlugins()` called from `main.tsx` before `bootPlugins()`. |
| 2026-05-15 | A | LANDED | Contract types (`DashboardWidget`, `DashboardWidgetSize`, `DashboardWidgetSlot`) + `PluginUI.dashboardWidgets` field shipped in `@boringos/ui`. `pluginHost.dashboardWidgets` getter sorts by (slot, order, moduleId). `useDashboardWidgets()` hook lives in shell `plugin-host/` (uses `useSyncExternalStore` + `useInstalledModules` gate — same pattern as Sidebar). `DashboardWidgetGrid` primitive with per-widget `ErrorBoundary` + `Suspense` skeleton. Slot-aware grid: primary = 4-col, secondary = 3-col. Note: task plan placed hook in `@boringos/ui`; moved to shell to match existing Sidebar pattern (pluginHost lives shell-side). |
| 2026-05-15 | — | DRAFTED | Plan written; approved for execution |
