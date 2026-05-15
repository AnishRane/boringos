// SPDX-License-Identifier: GPL-3.0-or-later
//
// Plugin UI Contract — task_19_plugin_ui_runtime.
//
// One declarative manifest per plugin. The plugin exports a
// `PluginUI` object; the shell's `pluginHost` registers it at boot.
// `<DynamicRoutes />` and `<Sidebar />` iterate the registry and
// render contributions, gated per-tenant by `useInstalledModules()`.
//
// `element` is a real `React.ComponentType` (or a lazy thunk) — not
// a symbolic name — so the contract is type-safe end-to-end.

import type { ComponentType, LazyExoticComponent } from "react";

export type PluginElement<P = Record<string, never>> =
  | ComponentType<P>
  | LazyExoticComponent<ComponentType<P>>;

export interface NavItem {
  /** Stable id. Sidebar uses this as the React key. */
  id: string;
  /** Human label rendered in the sidebar. */
  label: string;
  /** Optional Lucide icon (or any React component rendered as <Icon className=... />). */
  icon?: ComponentType<{ className?: string }>;
  /** Router path. May contain `:param` segments — e.g. `/crm/deals/:id`. */
  path: string;
  /** The page component the shell mounts at `path`. */
  element: PluginElement;
  /** Sort hint within the module's group. Lower first. Defaults to 100. */
  order?: number;
  /** Grouping label in the sidebar (rare — defaults to the plugin's name). */
  group?: string;
  /**
   * When true, the route mounts but the sidebar omits the link.
   * Use this for entity detail pages and any other routes the user
   * navigates to from in-page links rather than the sidebar.
   */
  hidden?: boolean;
}

export interface EntityPanel {
  /** Entity type id, e.g. "crm_contact". */
  entityKind: string;
  /** Stable id within the entity's panel set. */
  id: string;
  /** Tab/section label. */
  label: string;
  /** Component rendered with `{ entityId: string }`. */
  element: PluginElement<{ entityId: string }>;
  order?: number;
}

export interface EntityActionContext {
  log: { info: (msg: string, data?: Record<string, unknown>) => void };
  emit: (eventType: string, data: Record<string, unknown>) => Promise<void> | void;
}

export interface EntityAction {
  entityKind: string;
  id: string;
  label: string;
  /** Optional visibility predicate evaluated against the entity row. */
  visible?: (entity: { id: string; fields: Record<string, unknown> }) => boolean;
  /** Action handler. */
  invoke: (
    entity: { id: string; fields: Record<string, unknown> },
    ctx: EntityActionContext,
  ) => Promise<void>;
}

export interface SettingsPanel {
  id: string;
  label: string;
  element: PluginElement;
  order?: number;
}

export interface CopilotTool {
  /** Fully-qualified tool id, e.g. "crm.deals.list". */
  toolName: string;
  /** Optional override label shown in the copilot UI. */
  label?: string;
}

export interface InboxFilter {
  id: string;
  label: string;
  /** Predicate the inbox UI evaluates per item. */
  match: (item: { source?: string; metadata?: Record<string, unknown> }) => boolean;
}

/** Grid footprint. small = 1 col, medium = 2 cols, large = full row. */
export type DashboardWidgetSize = "small" | "medium" | "large";
/** Vertical placement bucket on the Home screen. */
export type DashboardWidgetSlot = "primary" | "secondary";

/**
 * A widget contributed to the shell Home dashboard. The shell wraps
 * each widget in an error boundary + Suspense fallback and arranges
 * widgets by (slot, order, moduleId) within a CSS grid. The widget
 * component receives no required props and is responsible for its
 * own data fetching via the existing `useTool` / framework hooks.
 */
export interface DashboardWidget {
  /** Stable id within the module's widget set. */
  id: string;
  /** Header label rendered above the widget body. */
  title: string;
  size: DashboardWidgetSize;
  slot: DashboardWidgetSlot;
  element: PluginElement;
  /** Sort hint within (slot, moduleId). Lower first. Defaults to 100. */
  order?: number;
}

/**
 * The complete plugin UI contribution. A plugin exports one of these
 * (typically named `<id>UI`); the shell registers it with `pluginHost.register(...)`.
 */
export interface PluginUI {
  /** Must match the server-side Module.id. */
  moduleId: string;
  /** Optional human name shown in the sidebar group header. Defaults to moduleId. */
  displayName?: string;
  navItems?: NavItem[];
  entityPanels?: EntityPanel[];
  entityActions?: EntityAction[];
  settingsPanels?: SettingsPanel[];
  copilotTools?: CopilotTool[];
  inboxFilters?: InboxFilter[];
  /** Widgets contributed to the shell Home dashboard (task_26). */
  dashboardWidgets?: DashboardWidget[];
}

// ─────────────────────────────────────────────────────────────────
// Realtime event shape — emitted by the framework when install
// state changes. Shell consumes via `useRealtimeEvent`.
// ─────────────────────────────────────────────────────────────────

export interface ModuleInstallEvent {
  type: "module_installed" | "module_uninstalled";
  moduleId: string;
  tenantId: string;
}
