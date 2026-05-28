---
"@boringos/module-sdk": minor
---

Make `PluginUI` (from `@boringos/ui`) the canonical UI contract that the SDK re-exports — module authors get all 7 slot types (`navItems`, `dashboardWidgets`, `entityPanels`, `entityActions`, `settingsPanels`, `copilotTools`, `inboxFilters`) plus `PluginElement`, `NavItem`, `EntityActionContext`, `DashboardWidgetSize`, `DashboardWidgetSlot` with one import. `@boringos/ui` is now an **optional** peer dependency — modules that don't ship a UI don't need it installed.

The legacy `ModuleUI` server-side type (symbolic component names, only 4 fields) is kept for backward compatibility but marked `@deprecated`; new modules should ship a separate web bundle exporting `<id>UI: PluginUI` and point `module.json`'s `ui.entry` / `ui.sourcePath` at it. MDK T3.2.
