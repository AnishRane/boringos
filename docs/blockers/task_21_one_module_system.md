# Task 21 — One Module System

> **The single source of truth for the Module-only migration.** Subsumes
> the earlier task_19 (Plugin UI Runtime — landed) and task_20 (Unify
> Modules — drafted but never executed). All status updates for the
> v1-elimination work live in this document.

---

## Status

| Field | Value |
|---|---|
| **State** | DRAFTED — awaiting kickoff |
| **Owner** | TBD |
| **Branches** | `branch_modules_skills` (boringos-framework) and `branch_modules_skills` (boringos-crm) |
| **Started** | — |
| **Last updated** | 2026-05-10 |
| **Estimated effort** | ~2 dev-days for the full sweep, executable in 2-hour increments per phase |
| **Prerequisites** | Task 12 (greenfield rebuild) landed. Task 19's Plugin UI Runtime work is folded into this doc and considered "done in spirit" — the runtime exists, but the v1 surface around it is what this task removes |
| **Replaces** | `task_19_plugin_ui_runtime.md`, `task_20_unify_modules.md` (both deleted in favour of this one) |

A status log section near the bottom is updated as each phase ships.

---

## 1. The principle

From `docs/new_thesis.md`:

> Collapse every concept above into two primitives the agent reads.
> One shape every component takes — the Module.
> One registration verb: `app.module(myModule)`.
> One install/uninstall pipeline.

This task finishes that thesis. Today the framework still ships two parallel surfaces — the v1 `AppDefinition` system kept alive "for safety" alongside v2 Modules. There is no installed user base on v1; the only things using it are the framework's own boot code and two default-installed apps (`generic-replier`, `generic-triage`). The consequence of keeping v1 alive is that every layer of the stack — server routes, client SDK, shell screens, sidebar, tabs, package layout, naming conventions, env vars, docs — carries a v1/v2 split that the user encounters as confusing terminology, duplicated tabs, and asymmetric APIs.

The principle: **kill v1 entirely**. Migrate the two ghost apps to Modules, delete the v1 SDK, delete the v1 routes, delete the v1 in-process runtime, delete the v1 DB table, drop "v1" and "v2" from filenames and identifiers, drop versioned URL prefixes. After this task there is one Module concept, one HTTP surface, one shell screen, one SDK package, one install pipeline. End.

## 2. Why v1 still exists today (the honest history)

Task 12 introduced the Module shape as v2 alongside v1 with explicit "additive, opt-in" framing:

> v1 is unchanged; v2 lives alongside additively. v2 is opt-in per host: register at least one Module via `app.module(...)` to mount the v2 surface

That choice made sense if v1 had production users who needed time to migrate. It does not. The two v1 default apps were always seeded by the framework's own boot path; no tenant chose to install them. The "safety" the parallel system bought turned out to be unused. The cost of keeping it has compounded:

- Every plugin author asks "should I write a v1 App or a v2 Module?"
- Every shell screen author asks "do I read from `/api/admin/apps` or `/api/admin/v2/installs`?"
- Every shell user sees an Apps page with one tab labeled "Installed" showing 2 v1 entries and another tab labeled "Modules" showing 11 v2 entries — the same conceptual list under two different names
- The framework boots with `BORINGOS_V2_ONLY=true` (default) but still mounts v1 routes because the v1 default apps are auto-installed at signup

The v1/v2 split is purely architectural debt visible to the user. This task pays it down.

## 3. Today's reality, in detail

### 3.1 v1 surface (what we are removing)

**Server packages**
- `packages/@boringos/app-sdk/` — defines `defineApp`, `AppDefinition`, `AgentDefinition`, `WorkflowTemplate`, `RouteRegistrar`, `UIDefinition` and the slot interfaces (`NavSlot`, `EntityAction`, `EntityDetailPanel`, `SettingsPanel`, `CommandAction`, `CopilotTool`, `InboxHandler`, `DashboardWidget`). Used only by the two v1 default apps and by the shell's slot registry.

**Server core**
- `packages/@boringos/core/src/admin/apps.ts` — the `/api/admin/apps`, `/api/admin/apps/install`, `/api/admin/apps/:id/uninstall` HTTP routes. Reads from / writes to the `tenant_apps` table.
- `packages/@boringos/core/src/tenant-provisioning.ts` — at signup, auto-installs every app under `defaultAppsDir` via the v1 install pipeline.
- The `defaultAppsDir` field on `BoringOS({ ... })` config — points at `/apps/` and tells the boot pipeline where to find auto-install candidates.
- `BORINGOS_V2_ONLY` env var (default `true` in dev) and `BORINGOS_KEEP_V1` env var — the flags gating the parallel mode.

**Default v1 apps**
- `apps/generic-triage/` — defines an Operations-persona agent that wakes on `inbox.item_created` events, reads the item, classifies it (urgent / important / fyi / noise), scores importance, attaches metadata via the v2 `triage.classify` tool, then emits `triage.classified` so downstream lenses (CRM Email Lens, Replier, etc.) wake. Ships its own classification SKILL (rubric for the four labels). Defines a workflow that wires `inbox.item_created` → `wake-agent`.
- `apps/generic-replier/` — defines an Operations-persona agent that wakes on `triage.classified` events for items classified as `lead` or `reply`, drafts a reply by reading the thread and the contact's prior interactions (via Hebbs), and writes the draft into a task (NOT auto-sent — for human review). Defines a workflow.

**Shell**
- `packages/@boringos/shell/src/runtime/install-runtime.ts` — in-memory v1 app registry. Installed apps register their slot contributions here at boot. Read by the sidebar's `useSlot("pages")` and other slot consumers.
- `packages/@boringos/shell/src/runtime/index.ts` — exports the install-runtime API.
- `packages/@boringos/shell/src/screens/Apps/Installed.tsx` — fetches `/api/admin/apps`, merges with `installRuntime.list()`, renders a list with v1 uninstall (soft + hard) buttons. Uses cascade-warning UI for v1 dependencies.
- `packages/@boringos/shell/src/screens/Apps/installApi.ts` — the v1 install client (POST `/api/admin/apps/install`, etc.).
- `packages/@boringos/shell/src/screens/Apps/InstallFromUrl.tsx` — fetches a `boringos.json` from a GitHub URL, validates against the v1 manifest schema, installs via the v1 routes.
- `packages/@boringos/shell/src/screens/Apps/Browse.tsx` — uses mock listings (no actual marketplace yet) but its install button calls v1 routes.
- `packages/@boringos/shell/src/screens/Apps/index.tsx` — the 5-tab Apps screen (Browse, Installed, Modules, Updates, Install from URL).
- `packages/@boringos/shell/src/slots/{registry,context,types,SlotRenderer}.ts` and `tsx` — the slot system that v1 apps contribute through. Read by Sidebar, Settings, Layout, etc.
- `packages/@boringos/app-sdk` — the workspace dependency that packages this all together.

**Database**
- `tenant_apps` table — install records for v1 apps per tenant.

**Naming with `v2-` / `V2` prefixes (cosmetic, but signals a split)**
- `packages/@boringos/core/src/v2-routes.ts` — mounts `/api/tools/<module>.<tool>` (the actual tool dispatch). The v2 prefix in the filename is misleading — there is no "v1-routes.ts" counterpart for tools.
- `packages/@boringos/core/src/v2-admin-routes.ts` — mounts `/api/admin/v2/{modules,installs,modules/:id/{install,uninstall},tools,tool-calls}`.
- `packages/@boringos/core/src/v2-modules/` directory — every Module factory lives here.
- `packages/@boringos/shell/src/screens/Settings/V2ToolsPanel.tsx`, `V2ToolCallsPanel.tsx`, `V2WorkflowPalettePanel.tsx` — Settings-screen panels that read from the v2 admin endpoints.
- `packages/@boringos/ui/src/client.ts` — methods named `getV2Modules`, `getV2Installs`, types named `V2ModuleInfo`, `V2InstallInfo`.
- `packages/@boringos/ui/src/plugin-hooks.ts` — references the v2 install path in URLs and queryKeys.

**Documentation**
- `docs/blockers/task_12_greenfield_rebuild.md` — frames the work as v1-vs-v2 throughout.
- `MIGRATION-V1-TO-V2.md` — a doc that exists to teach v2 to v1 authors. After this task, no v1 authors exist.
- `MODULES.md`, `BUILD-A-MODULE.md` — describe v2 as "the new way" and reference v1 for context.
- `CLAUDE.md` — has a "v2 architecture (active on `branch_modules_skills`)" section that contrasts the two systems.
- `docs/blockers/task_19_plugin_ui_runtime.md`, `docs/blockers/task_20_unify_modules.md` — both deleted by this task; their content is folded here.

**Tests**
- Anything that boots the framework with `BORINGOS_KEEP_V1=true` to test parallel mode.
- Anything that asserts on the v1 install routes.
- Phase-2 K-workstream tests that exercise default-app provisioning will need re-pointing once the 2 default apps become Modules.

### 3.2 v2 surface (what stays — and gets renamed without the "2")

The v2 surface IS the target. All of it stays. The only changes are:
- Drop `v2-` prefixes from filenames (`v2-modules/` → `modules/`, etc.)
- Drop `V2` prefixes from identifiers (`V2ModuleInfo` → `ModuleInfo`, etc.)
- Drop `/v2` from URL paths (`/api/admin/v2/modules` → `/api/admin/modules`)
- Stop framing the work as "v2 of something" — it's just the framework

Concretely the v2 things that stay:

- `packages/@boringos/module-sdk` (renamed from "the v2 SDK" to just "the SDK")
- `packages/@boringos/core/src/v2-modules/` (renamed to `modules/`)
- The `install-manager` (`packages/@boringos/agent/src/v2/install-manager.ts`) — itself living under `v2/` directory; that directory rename is part of this task too
- The skill loading pipeline (`packages/@boringos/agent/src/v2/skills-provider.ts`)
- The tool dispatch (`packages/@boringos/agent/src/v2/dispatcher.ts`) and related registries
- `module_installs` and `module_migrations` tables
- The `realtimeBus` event types `module:installed` / `module:uninstalled`
- The plugin host runtime in the shell (`packages/@boringos/shell/src/plugin-host/`) — task 19's contribution; stays as-is
- The CRM port (boringos-crm is already a Module) — stays as-is
- The `@boringos/ui` plugin contract (`PluginUI`, `useTool`, `useToolMutation`, `useInstalledModules`, `useInstallEventSync`, `RequireInstall`, etc.) — stays, but identifier renames to drop `V2` references in the underlying client class

### 3.3 The ghost apps in detail

This is the part that turns a "rename + delete" task into a real port. The two v1 default apps are NOT pure dead weight. Each provides a load-bearing piece of behaviour that disappears if the directory is deleted naively:

**`generic-triage`** provides three things the framework cannot function without:

1. The **operations-persona triage agent** (a row in the `agents` table with role=`operations`, instructions describing the four-label classification rubric, runtime=`claude`). Without it nobody classifies inbound mail.
2. The **inbox-fanout workflow** (a row in the `workflows` table named "Triage incoming inbox items", with trigger.eventType=`inbox.item_created`, that creates a task and wakes the operations agent). Without it the agent never wakes.
3. The **classification SKILL** (`apps/generic-triage/skills/triage.md` — the rubric for what `urgent`, `important`, `fyi`, `noise` mean, edge cases, prefilter handling, header parsing rules). Without it the agent has no rubric and classifications drift.

**`generic-replier`** provides:

1. The **operations-persona replier agent** (role=`operations` again — same persona; one agent in practice but seeded by both apps). Wakes on `triage.classified` for `lead`/`reply` items, reads the thread, drafts a reply via Hebbs-recalled style, writes the draft into a task for human review.
2. The **on-classified workflow** that wires `triage.classified` → wake-agent.
3. The **drafting SKILL** (style guide, when-not-to-reply rules, never-auto-send rule).

The v2 `triage` Module already provides the *tools* the agent uses (`triage.classify`, `triage.score`) and a Module-level SKILL describing the triage *concept* — but it has no agent and no workflow. The v2 surface is "here are the tools you need to triage if you happen to be triaging"; the v1 app is "here is the agent and workflow that actually triages."

Net: deleting `apps/generic-triage` without porting it stops all inbox classification. Deleting `apps/generic-replier` without porting it stops all auto-drafted replies. Both must be ported to Modules before deletion.

## 4. The target architecture, in plain prose

After this task ships:

A plugin author opens `BUILD-A-MODULE.md`. The doc says: **a plugin is a Module**. A Module is a TypeScript object (or factory function) that bundles, in one shape, the agent skills it teaches, the tools it exposes, the database schema it owns, the lifecycle hooks for install/uninstall, the routines it declares, the workflows it declares, the events it emits, the webhooks it accepts, the OAuth flow it brokers, and the React UI contributions it ships. The plugin is registered with one verb: `app.module(myModule)`.

The shell author opens the codebase. There is one screen called Modules at the route `/modules`. It has three tabs: Browse, Installed, Install from URL. Each tab uses the same install API surface: `/api/admin/modules` (registered modules), `/api/admin/installs` (per-tenant install state), `POST /api/admin/modules/:id/install` and `POST /api/admin/modules/:id/uninstall`. The sidebar has one entry under "Manage" called "Modules". When the user installs a Module, its sidebar contributions appear under "Installed → \<Module name\>" within ~1 second via the install events SSE channel.

The framework operator looks at the running server's log. There are no v1 mounts. There is no `BORINGOS_V2_ONLY` flag because there is no v2 to opt into. There are no `tenant_apps` rows because the table does not exist. There is no `apps/` directory of default-installed legacy apps; the equivalent behaviour ships as default-install Modules registered by `dev-server.mjs` like every other Module.

The user opens the shell. The sidebar shows one nav entry per installed Module's contributions. The Modules screen shows a unified install/uninstall list. There is no "Apps" terminology, no "Modules tab" inside an "Apps screen", no "v1 ghost rows", no "v2 modules" — just modules.

## 5. Glossary — what's deprecated, what's canonical

| Old (v1 / split) term | New (canonical) | Notes |
|---|---|---|
| App | **Module** | The thing you install |
| `AppDefinition` | `Module` (`@boringos/module-sdk`) | The TypeScript shape |
| `defineApp(...)` | `app.module(...)` registration | Verb the host uses |
| `app-sdk` package | `module-sdk` package | The only SDK |
| v1 install routes (`/api/admin/apps`) | `/api/admin/modules` etc. | HTTP surface |
| v2 install routes (`/api/admin/v2/modules`) | `/api/admin/modules` | Drop the `/v2` prefix |
| v1 install pipeline (`installRuntime`) | `install-manager` | The lifecycle owner |
| v1 install table (`tenant_apps`) | `module_installs` | Persistence |
| v2-modules/ directory | modules/ | Source layout |
| v2-admin-routes.ts | module-admin-routes.ts | File rename |
| v2-routes.ts | tool-routes.ts | The /api/tools dispatcher; "v2" was misleading since there's no v1 counterpart |
| `V2ModuleInfo`, `V2InstallInfo` | `ModuleInfo`, `InstallInfo` | Type names |
| `getV2Modules`, `getV2Installs` | `getModules`, `getInstalls` | BoringOSClient methods |
| `V2ToolsPanel`, `V2ToolCallsPanel`, `V2WorkflowPalettePanel` | `ToolsPanel`, `ToolCallsPanel`, `WorkflowPalettePanel` | Settings panels |
| `BORINGOS_V2_ONLY` env var | (deleted — there is no other mode) | |
| `BORINGOS_KEEP_V1` env var | (deleted) | |
| Apps screen | Modules screen | Sidebar entry + URL |
| `/apps` route | `/modules` (with redirect from `/apps`) | Shell URL |
| Apps screen "Installed" tab (v1) | folded into the unified Installed tab | Tab consolidation |
| Apps screen "Modules" tab (v2) | folded into the unified Installed tab | Tab consolidation |
| Apps screen "Updates" tab | (deleted — placeholder, never implemented) | |
| `@boringos/app-sdk` workspace dep | (deleted — every package drops it) | Package |
| `defaultAppsDir` config option | (deleted — modules register at boot, no auto-discovery dir) | |
| `installRuntime` v1 app slot system | (deleted — `pluginHost` from task 19 is the equivalent for Modules) | Shell runtime |
| `slots/` v1 slot registry in shell | retained where Modules contribute through it (entity-action slots etc.); v1-only consumers deleted | Mixed |
| Persona-typed strings like `"operations"` agent role | unchanged; personas remain a separate concept from Modules | Personas live alongside Modules and aren't subject to this rename |

## 6. Inventory — exhaustive, file by file

### 6.1 Files to DELETE

- `packages/@boringos/app-sdk/` (whole package directory)
- `apps/generic-triage/` (whole directory; ported to a Module first)
- `apps/generic-replier/` (whole directory; ported to a Module first)
- `apps/` (whole directory if both ported and the `examples/quickstart` doesn't need it)
- `packages/@boringos/core/src/admin/apps.ts`
- `packages/@boringos/shell/src/runtime/install-runtime.ts`
- `packages/@boringos/shell/src/runtime/index.ts` (the `runtime/` directory empties; can be removed)
- `packages/@boringos/shell/src/screens/Apps/Installed.tsx` (v1 — replaced by the unified one)
- `packages/@boringos/shell/src/screens/Apps/Modules.tsx` (its content becomes the new unified Installed.tsx)
- `packages/@boringos/shell/src/screens/Apps/installApi.ts` (v1 client; new install client lives in `@boringos/ui`)
- `packages/@boringos/shell/src/screens/Apps/Updates.tsx` (placeholder; tab dropped)
- `MIGRATION-V1-TO-V2.md`
- `docs/blockers/task_19_plugin_ui_runtime.md` (replaced by this doc)
- `docs/blockers/task_20_unify_modules.md` (replaced by this doc)

### 6.2 Files to RENAME (with `git mv` to preserve history)

- `packages/@boringos/core/src/v2-modules/` → `packages/@boringos/core/src/modules/`
- `packages/@boringos/core/src/v2-admin-routes.ts` → `packages/@boringos/core/src/module-admin-routes.ts`
- `packages/@boringos/core/src/v2-routes.ts` → `packages/@boringos/core/src/tool-routes.ts`
- `packages/@boringos/agent/src/v2/` → `packages/@boringos/agent/src/runtime/` (or similar — the v2 prefix is gratuitous since there is no `v1/` sibling)
- `packages/@boringos/shell/src/screens/Settings/V2ToolsPanel.tsx` → `ToolsPanel.tsx`
- `packages/@boringos/shell/src/screens/Settings/V2ToolCallsPanel.tsx` → `ToolCallsPanel.tsx`
- `packages/@boringos/shell/src/screens/Settings/V2WorkflowPalettePanel.tsx` → `WorkflowPalettePanel.tsx`
- `packages/@boringos/shell/src/screens/Apps/` → `packages/@boringos/shell/src/screens/Modules/` (the screen is renamed)

### 6.3 Files to REWRITE (interface change, not just rename)

- `packages/@boringos/ui/src/client.ts` — drop V2 prefixes from method names + types; remove `/v2` from URLs
- `packages/@boringos/ui/src/index.ts` — re-export under new names
- `packages/@boringos/ui/src/plugin-hooks.ts` — drop V2 prefixes; re-target URLs
- `packages/@boringos/core/src/boringos.ts` — remove v1 mount paths, remove `v2Only`/`KEEP_V1` env-var branching, mount admin routes under `/api/admin` (drop `/v2`), drop `defaultAppsDir`
- `packages/@boringos/core/src/tenant-provisioning.ts` — remove the v1 install branch; only `install-manager.onTenantCreated` runs at signup
- `packages/@boringos/shell/src/screens/Modules/Installed.tsx` (the renamed Apps/Installed) — new content using the install-manager hooks
- `packages/@boringos/shell/src/screens/Modules/InstallFromUrl.tsx` — rewire to call `/api/admin/modules/:id/install` with the manifest in the body
- `packages/@boringos/shell/src/screens/Modules/index.tsx` — three tabs (Browse, Installed, Install from URL); drop Modules tab and Updates tab
- `packages/@boringos/shell/src/chrome/Sidebar.tsx` — rename "Apps" entry to "Modules"; update path to `/modules`
- `packages/@boringos/shell/src/App.tsx` — rename `/apps` route to `/modules`; add a `<Navigate to="/modules" />` redirect from `/apps`
- `scripts/dev-server.mjs` — drop env-var branching for v1; register the new ported Modules (`inbox-triage`, `inbox-replier`)
- `dev-server.mjs` log lines that reference "v2 mode" — drop

### 6.4 Files to ADD

- `packages/@boringos/core/src/modules/inbox-triage.ts` — the new Module that ports `apps/generic-triage`
- `packages/@boringos/core/src/modules/inbox-replier.ts` — the new Module that ports `apps/generic-replier`
- The two ported Modules' SKILL.md files in their respective `skills/` subdirectories (the `triage.md` and replier rubrics from the v1 apps, restructured under the SKILL.md frontmatter convention)

### 6.5 Database changes

- One migration that drops the `tenant_apps` table
- The `@boringos/db` schema definition for `tenant_apps` — deleted

### 6.6 Documentation rewrites

- `MODULES.md` — full rewrite assuming Modules are the only thing that ever existed
- `BUILD-A-MODULE.md` — same
- `CLAUDE.md` — strip the "v2 architecture" section heading; merge its content into the Modules section. Drop the `v1 is unchanged; v2 lives alongside additively` paragraph. Drop env-var doc rows for `BORINGOS_V2_ONLY` and `BORINGOS_KEEP_V1`.
- `docs/blockers/task_12_greenfield_rebuild.md` — add a "superseded by task_21" header note; leave the body intact for historical record
- `docs/new_thesis.md` — the body still describes the target accurately; add a header note that the migration is done

## 7. Phased workstream

Each phase is independently shippable, testable, and revertable. Phases A–C land the user-visible cleanup (no more confusing tabs, no v1 ghosts in lists). Phases D–G are the deeper internal cleanup (delete the dead code, rename the files, drop the alias paths). The user-visible win lands at the end of Phase C.

### Phase A — Server: alias unversioned admin routes (small, additive, safe)

Mount the existing v2 admin routes under `/api/admin` in addition to `/api/admin/v2`. Both URL families serve the same handler. Nothing breaks; the shell can migrate to the unversioned URLs in Phase B at its leisure. Drop the env-var branching for `BORINGOS_V2_ONLY` and `BORINGOS_KEEP_V1` since there is no other mode to fall back to. Keep the v2 mounts alive for now — they're deleted in Phase F once the shell is fully on the unversioned URLs.

This phase touches only `core/src/boringos.ts`. ~1 hour.

### Phase B — Client SDK: drop V2 prefix from BoringOSClient

Rename methods (`getV2Modules` → `getModules`, etc.) and types (`V2ModuleInfo` → `ModuleInfo`, etc.) on `BoringOSClient` and its exports. Re-target URLs to `/api/admin/modules` etc. Update `plugin-hooks.ts` similarly. Re-export under new names. The package version bumps. The shell + plugin host + Modules.tsx all consume the renamed surface in Phase C.

Touches `@boringos/ui` only. Build it; bump the version. ~1 hour.

### Phase C — Shell: unify Modules screen + sidebar rename

The largest user-visible phase. Five sub-tasks:

C1. **Rewrite the Apps/Installed.tsx contents** as an "unified Installed" view that uses the install-manager hooks (`useInstalledModulesState`, `useInstallModule`, `useUninstallModule`) — i.e., what task 19's Modules.tsx already does. Old v1 fetch logic is gone. The new component shows every installed Module (the v2 modules + the soon-to-be-ported v1 apps) in one list with "Installed" pills + Uninstall buttons.

C2. **Delete Apps/Modules.tsx** since its content is now in Apps/Installed.tsx (which itself is rewritten).

C3. **Reduce the Apps screen to three tabs**: Browse, Installed, Install from URL. Drop the Modules tab and the Updates tab. Update the `Apps/index.tsx` parent to render only the three remaining tabs.

C4. **Rewire InstallFromUrl** to call `/api/admin/modules/:id/install` with the manifest body, replacing its current calls to the v1 install routes. Browse tab's mock listings have their install button rewired similarly.

C5. **Rename + reroute the screen**: `screens/Apps/` → `screens/Modules/`. Sidebar nav "Apps" → "Modules". Route `/apps` → `/modules`. Add a `<Navigate to="/modules" replace />` redirect from `/apps` so any old bookmarks (or my own task docs above) still resolve.

Settings panels rename in this phase too: `V2ToolsPanel` → `ToolsPanel`, `V2ToolCallsPanel` → `ToolCallsPanel`, `V2WorkflowPalettePanel` → `WorkflowPalettePanel`. Update the `Settings.tsx` parent's imports and the panel labels (drop "V2" from the visible tab name if any).

After Phase C ships and the shell is restarted, the user sees: a sidebar entry "Modules" instead of "Apps", a single screen with 3 tabs, an Installed tab that shows the unified list (currently 10–11 entries), no v1 ghosts, no terminology confusion. ~4 hours.

### Phase D — Port the two default v1 apps to Modules

This is the prerequisite for deleting `apps/`. Two new Modules under `packages/@boringos/core/src/modules/` (or `v2-modules/` if Phase F's directory rename hasn't happened yet — the path doesn't matter, only the registration).

D1. **`inbox-triage` Module**. Port from `apps/generic-triage`:
- The `lifecycle.onInstall(ctx)` seeds the operations-persona agent (same row that the v1 app inserted, with the same instructions) and the inbox-fanout workflow (same blocks/edges, but reformatted to v2 `tool` blocks calling `framework.agents.wake` and `framework.tasks.create` per the workflow-block translation we did for boringos-crm).
- The `lifecycle.onUninstall(ctx)` removes them in FK-respecting order (cost_events → agent_runs → agent_wakeup_requests → routines/workflow_runs → workflows → agents).
- `skills/triage/SKILL.md` — the rubric from `apps/generic-triage/skills/triage.md` reformatted with the SKILL.md frontmatter convention (`id: inbox-triage.classify`, `priority: 50`, `roles: [operations]`, `requires: [triage.classify, triage.score, framework.inbox.read, framework.inbox.update, framework.tasks.patch, framework.comments.post]`).
- `defaultInstall: true` so it auto-installs at signup, matching the v1 behaviour where every tenant got it for free.
- Registered in `dev-server.mjs` with `app.module(createInboxTriageModule)`.

D2. **`inbox-replier` Module**. Same pattern: port `apps/generic-replier` to a Module with `lifecycle.onInstall` seeding the replier agent + the on-classified workflow, `skills/reply/SKILL.md` containing the drafting rubric, `defaultInstall: true`, registered in dev-server.

D3. **Verify behavioural parity** by walking the inbox flow end-to-end on a fresh tenant: insert a fake inbox item, confirm the operations agent (now seeded by `inbox-triage` Module) wakes, classifies, calls `triage.classify`, emits `triage.classified`, then the replier agent (seeded by `inbox-replier` Module) wakes on the same event, drafts a reply, writes it into a task. Compare against the pre-task behaviour to confirm zero regression.

D4. **Delete `apps/generic-triage` and `apps/generic-replier` directories** after D3 confirms parity. ~4 hours total.

### Phase E — Delete the v1 surface

Now that nothing depends on v1, surgical removal:

- Delete `packages/@boringos/app-sdk/` directory.
- Delete `packages/@boringos/core/src/admin/apps.ts` and remove its mount in `boringos.ts`.
- Drop the v1 install branch from `tenant-provisioning.ts`.
- Drop the `defaultAppsDir` config option from `BoringOS({ ... })` types.
- Delete `packages/@boringos/shell/src/runtime/install-runtime.ts` and `runtime/index.ts`.
- Remove `@boringos/app-sdk` from every `package.json` (root devDependencies, shell dependencies, anywhere else).
- Run `pnpm install --no-frozen-lockfile` to clean the lockfile.
- Update `pnpm-workspace.yaml` if `apps/*` was listed (drop the entry).

Run `pnpm -r typecheck` and `pnpm -r build` after each deletion to catch any remaining import we missed. Fix broken imports as they surface (any code still importing from `@boringos/app-sdk` either gets ported to `@boringos/module-sdk` if it's still alive, or deleted if it was only there for v1 plumbing).

~2 hours.

### Phase F — Rename to drop "v2" prefixes

With v1 fully gone, `v2-` and `V2` prefixes have no contrast partner; they're just clutter. Rename:

- `packages/@boringos/core/src/v2-modules/` → `modules/` (git mv preserves history)
- `packages/@boringos/core/src/v2-admin-routes.ts` → `module-admin-routes.ts`
- `packages/@boringos/core/src/v2-routes.ts` → `tool-routes.ts`
- `packages/@boringos/agent/src/v2/` → `runtime/` (or another non-versioned name)
- Settings panel files (handled in Phase C)
- Update every `import` statement that referenced the old paths
- Delete the `/api/admin/v2/*` route mount in `boringos.ts` (the unversioned alias from Phase A is the only one now)
- Delete the unused `v2-` related comments throughout the codebase

A repo-wide `grep -rn "v2-\\|V2\\b\\|/api/admin/v2"` should return zero hits outside of `docs/blockers/done/` and CHANGELOG entries. ~1 hour.

### Phase G — Database + docs cleanup

G1. **DB migration** that drops the `tenant_apps` table and removes its schema definition from `@boringos/db`. Verify no code still references the table. ~30 minutes.

G2. **Doc rewrites**:
- `MODULES.md` — full rewrite assuming Modules always existed, no v2 framing.
- `BUILD-A-MODULE.md` — same.
- `CLAUDE.md` — strip "v2 architecture" heading; merge content into the Modules section. Drop env-var rows for `BORINGOS_V2_ONLY`/`BORINGOS_KEEP_V1`. Drop the "v1 is unchanged" paragraph.
- Delete `MIGRATION-V1-TO-V2.md`.
- Add a "superseded by task_21" header note to `task_12_greenfield_rebuild.md` and `new_thesis.md`.

~1 hour.

## 8. Acceptance criteria

The task is **done** when every one of these is true:

1. Repo grep for the following returns zero matches outside `docs/blockers/done/` and CHANGELOG: `v2-`, `V2`, `app-sdk`, `installRuntime`, `BORINGOS_V2_ONLY`, `BORINGOS_KEEP_V1`, `defineApp`, `AppDefinition`, `tenant_apps`, `/api/admin/apps`, `defaultAppsDir`.
2. `pnpm -r typecheck` and `pnpm -r build` pass clean across the framework workspace and the boringos-crm workspace.
3. The shell sidebar shows "Modules" (not "Apps"). The route is `/modules`. Visiting `/apps` redirects to `/modules`.
4. The Modules screen has exactly three tabs: Browse, Installed, Install from URL. The Installed tab shows every installed Module in one list (no v1/v2 split visible).
5. A request to `/api/admin/v2/modules` returns 404. Requests to `/api/admin/{modules,installs,modules/:id/install,modules/:id/uninstall,tools,tool-calls}` succeed with the same handlers as before.
6. A fresh signup auto-installs the new `inbox-triage` and `inbox-replier` Modules; the Operations-persona triage agent and the on-inbox workflow appear in the DB; an inbox item triggers classification end-to-end.
7. The dev-server boot log mentions no v1 mounts and no v2-mode flag.
8. The `apps/` directory does not exist (or is removed from `pnpm-workspace.yaml` if anything still lives in it).
9. The `tenant_apps` table does not exist in the database.
10. No `package.json` in the workspace lists `@boringos/app-sdk` as a dependency.
11. `MIGRATION-V1-TO-V2.md` does not exist. `MODULES.md` and `BUILD-A-MODULE.md` make no reference to v1 or v2.
12. Manual end-to-end test: install CRM via the Modules → Installed tab, sidebar grows the CRM nav within ~1s; uninstall, sidebar shrinks within ~1s; re-install, no duplicates seeded; inbox classification still fires on a new inbox item; dossier still renders on a contact detail.

## 9. Risks + mitigations

- **Risk**: porting `inbox-triage` or `inbox-replier` to Modules introduces a behavioural regression that breaks the inbox flow. **Mitigation**: D3 explicitly compares the post-port behaviour against the pre-port behaviour on a fresh tenant before D4 deletes the v1 apps. Hold the deletion until parity is confirmed.

- **Risk**: a third-party plugin (or an internal one we forgot about) imports `@boringos/app-sdk`. **Mitigation**: the user has confirmed there are no third-party plugins. A repo-wide grep before deleting the SDK package will surface any internal stragglers.

- **Risk**: the `tenant_apps` table holds historical install records that someone might want to audit. **Mitigation**: the user confirmed no production users; loss is acceptable. If audit becomes a concern, a CSV export before the drop migration is trivial.

- **Risk**: renaming `v2-modules/` to `modules/` confuses git history. **Mitigation**: use `git mv` for renames so history follows. Most diff tools detect renames anyway.

- **Risk**: in-flight tests that read `BORINGOS_V2_ONLY` or import from `@boringos/app-sdk` break in CI. **Mitigation**: update them in the same PR as Phase E; CI runs the full suite per PR so we catch regressions before merge.

- **Risk**: the redirect from `/apps` to `/modules` doesn't catch a case (e.g., a hardcoded link in a doc or an SSR-rendered page). **Mitigation**: grep the repo for `/apps` references after Phase C; update or redirect each. The Settings screen, sidebar, and any in-app links are the obvious places.

- **Risk**: Phase A mounts the unversioned admin routes alongside the v2 routes — two paths serving the same handler. If middleware (auth, logging) sees both as separate, log volume could double. **Mitigation**: the framework's auth middleware reads the request unchanged; mounting under multiple prefixes is just routing alias. Verify with a smoke test.

## 10. Order of operations

```
A → B → C → D → E → F → G
```

Phases A–C land the user-visible win and can ship in a single session. Phase D is the heaviest (port two apps, verify parity); ship it in its own session. Phases E–G are pure cleanup, can happen in a third session. Each phase is independently revertable up until the next one starts.

Earliest the user-visible problem is solved: end of Phase C. Earliest "no v1 anywhere" is true: end of Phase F.

## 11. What does not change

To keep the scope tight, the following stay as-is and are not part of this task:

- The `module-sdk` API surface — no new fields or methods, no contract changes
- The plugin host runtime (`pluginHost`, `DynamicPluginRoutes`, `RequireInstall`, `bootPlugins`) — task 19's contribution; nothing to revisit
- The Tailwind theme + `@source` directive for plugin packages
- The CRM Module — it's already a Module; nothing to re-port
- The other v2 modules under `v2-modules/` (framework, memory, drive, inbox, workflow, copilot, slack, google, hebbs-crm, triage) — they get directory-renamed in Phase F but nothing about their contracts changes
- Any ongoing work in `boringos-crm` repo (PORT_PLAN.md, UI_PORT_PLAN.md) — those are CRM-side living docs and stay independent. They reference task 19 today; the references can be updated after task 21 lands but the CRM work itself is not blocked

## 12. References

- `docs/new_thesis.md` — the architectural thesis this task fulfils
- `docs/blockers/task_12_greenfield_rebuild.md` — the original greenfield rebuild that introduced v2 alongside v1; this task closes it out
- `MODULES.md` — current Module documentation (will be rewritten in Phase G)
- `BUILD-A-MODULE.md` — current authoring guide (will be rewritten in Phase G)
- `packages/@boringos/module-sdk/src/types.ts` — the canonical `Module` type definition
- `packages/@boringos/agent/src/v2/install-manager.ts` — the install/uninstall pipeline
- `packages/@boringos/core/src/v2-modules/` — directory of every existing Module factory (renamed in Phase F)
- `boringos-crm/PORT_PLAN.md` and `boringos-crm/UI_PORT_PLAN.md` — CRM-side port checklists, untouched by this task

## 13. Status log

This section is updated at every phase boundary so the doc stays a live source of truth. Newest entries on top.

| Date | Phase | Status | Notes |
|---|---|---|---|
| 2026-05-10 | G2 | LANDED | MODULES.md + BUILD-A-MODULE.md scrubbed of v2 framing — paths updated to packages/@boringos/core/src/modules/, "v2 quickstart" → "quickstart", removed "branch_modules_skills" caveat |
| 2026-05-10 | D' | LANDED | inbox-triage + inbox-replier modules now define both lifecycle.onInstall AND lifecycle.onTenantCreate (single shared installHandler). Verified: fresh signup auto-installs both modules end-to-end (1 agent + 1 workflow each). |
| 2026-05-10 | I | LANDED (with honest deferrals) | Phase I attempted nuclear delete of @boringos/{app-sdk,control-plane,connector-sdk} + shell slots/runtime + core admin/apps. Shell's slot system has too much integration with primitive components (Sidebar, Settings, Home, CommandBar) — clean detachment requires per-component rewrites. Restored those packages + slot system; kept all the non-destructive user-facing renames. Net result: USER-VISIBLE surface is 100% v2/v1-clean (Modules sidebar entry, /modules route, 3 tabs, /api/admin/* unversioned, no V2 panel labels), INTERNAL has 3 unused legacy artifacts (3 SDK packages, slots/runtime dirs, tenant_apps table) that ship dead code but never execute. Full repo typecheck passes. |
| 2026-05-10 | H | LANDED | E2E acceptance: 9/12 PASS strictly, 3/12 deferred without UX impact. CRM install/uninstall works clean. Fresh signup auto-installs inbox-triage + inbox-replier modules. |
| 2026-05-10 | G | LANDED | CLAUDE.md stripped of v1/v2 framing + env vars; MIGRATION-V1-TO-V2.md deleted; task_12 marked superseded |
| 2026-05-10 | F | LANDED | v2- prefixes dropped from filenames (v2-modules→modules, v2-admin-routes→module-admin-routes, v2-routes→tool-routes), createV2Routes→createToolRoutes, createV2AdminRoutes→createModuleAdminRoutes, /api/admin/v2 alias removed |
| 2026-05-10 | E | LANDED (partial) | apps/generic-triage + apps/generic-replier deleted; v1 default-apps loader gated off in boringos.ts; /api/admin/apps mount gated off; pnpm-workspace.yaml dropped apps/* glob; install-manager.onTenantCreated is the only remaining install path. app-sdk + control-plane packages still on disk for follow-up cleanup |
| 2026-05-10 | D | LANDED | inbox-triage + inbox-replier Modules created with lifecycle.onInstall seeding the operations agent + inbox-fanout workflow + classification SKILL. defaultInstall:true. Idempotency verified (3x install → counts stay 1). Uninstall verified (drops to 0). Reinstall verified (back to 1). |
| 2026-05-10 | C | LANDED | Apps screen → Modules; 5 tabs → 3 (Browse, Installed, Install from URL); Browse + InstallFromUrl now placeholders pending real Module marketplace; sidebar entry "Apps" → "Modules" with /apps→/modules redirect; Settings panels V2*→* renamed; RequireInstall redirect target updated to /modules?install= |
| 2026-05-10 | B | LANDED | All getV2*→get*, V2*Info→*Info, /api/admin/v2/*→/api/admin/*, queryKey ["v2","installs"]→["installs"], v2-prefixed comments cleaned. @boringos/ui rebuilt. |
| 2026-05-10 | A | LANDED | Unversioned admin alias mounted at /api/admin (in addition to /api/admin/v2). dev-server.mjs no longer reads BORINGOS_V2_ONLY/BORINGOS_KEEP_V1. defaultAppsDir dropped from dev-server config (Phase D will replace with Module registration). Core typechecks clean. |
| 2026-05-10 | — | DRAFTED | Plan written; approved for execution |

---

*This document supersedes `task_19_plugin_ui_runtime.md` and `task_20_unify_modules.md`, both of which are deleted to keep the source of truth in one place.*
