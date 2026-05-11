// SPDX-License-Identifier: BUSL-1.1
//
// Plugin host registry — task_19. In-memory store of every
// `PluginUI` contribution registered at shell boot from
// modules.config.ts. Sidebar + DynamicPluginRoutes + EntityRouter
// read from this; install gating happens at the consumer (filter
// by useInstalledModules()).

import type {
  PluginUI,
  NavItem,
  EntityPanel,
  EntityAction,
  SettingsPanel,
  CopilotTool,
  InboxFilter,
} from "@boringos/ui";

export interface PluginHost {
  register(ui: PluginUI): void;
  /** All registered modules. */
  modules: PluginUI[];
  /** All nav items (sorted by module label, then order). Each carries its moduleId. */
  navItems: Array<NavItem & { moduleId: string; moduleLabel: string }>;
  /** Entity panels keyed by entityKind. */
  entityPanelsFor(entityKind: string): Array<EntityPanel & { moduleId: string }>;
  /** Entity actions keyed by entityKind. */
  entityActionsFor(entityKind: string): Array<EntityAction & { moduleId: string }>;
  /** Settings panels (sorted by label). */
  settingsPanels: Array<SettingsPanel & { moduleId: string }>;
  /** Copilot tools (flat). */
  copilotTools: Array<CopilotTool & { moduleId: string }>;
  /** Inbox filters (flat). */
  inboxFilters: Array<InboxFilter & { moduleId: string }>;
}

function createPluginHost(): PluginHost {
  const modules: PluginUI[] = [];

  return {
    register(ui) {
      // Idempotent — last write wins on conflict (rare; logs in dev).
      const existing = modules.findIndex((m) => m.moduleId === ui.moduleId);
      if (existing >= 0) {
        // eslint-disable-next-line no-console
        console.warn(`[pluginHost] re-registering ${ui.moduleId} — overwriting prior contribution`);
        modules[existing] = ui;
      } else {
        modules.push(ui);
      }
    },
    get modules() {
      return modules;
    },
    get navItems() {
      const out: Array<NavItem & { moduleId: string; moduleLabel: string }> = [];
      for (const m of modules) {
        for (const n of m.navItems ?? []) {
          out.push({ ...n, moduleId: m.moduleId, moduleLabel: m.displayName ?? m.moduleId });
        }
      }
      return out.sort(
        (a, b) =>
          a.moduleLabel.localeCompare(b.moduleLabel) ||
          (a.order ?? 100) - (b.order ?? 100),
      );
    },
    entityPanelsFor(entityKind) {
      const out: Array<EntityPanel & { moduleId: string }> = [];
      for (const m of modules) {
        for (const p of m.entityPanels ?? []) {
          if (p.entityKind === entityKind) out.push({ ...p, moduleId: m.moduleId });
        }
      }
      return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    },
    entityActionsFor(entityKind) {
      const out: Array<EntityAction & { moduleId: string }> = [];
      for (const m of modules) {
        for (const a of m.entityActions ?? []) {
          if (a.entityKind === entityKind) out.push({ ...a, moduleId: m.moduleId });
        }
      }
      return out;
    },
    get settingsPanels() {
      const out: Array<SettingsPanel & { moduleId: string }> = [];
      for (const m of modules) {
        for (const p of m.settingsPanels ?? []) {
          out.push({ ...p, moduleId: m.moduleId });
        }
      }
      return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    },
    get copilotTools() {
      const out: Array<CopilotTool & { moduleId: string }> = [];
      for (const m of modules) {
        for (const t of m.copilotTools ?? []) {
          out.push({ ...t, moduleId: m.moduleId });
        }
      }
      return out;
    },
    get inboxFilters() {
      const out: Array<InboxFilter & { moduleId: string }> = [];
      for (const m of modules) {
        for (const f of m.inboxFilters ?? []) {
          out.push({ ...f, moduleId: m.moduleId });
        }
      }
      return out;
    },
  };
}

export const pluginHost: PluginHost = createPluginHost();
