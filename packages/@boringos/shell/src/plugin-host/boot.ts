// SPDX-License-Identifier: BUSL-1.1
//
// At shell boot, walk modules.config.ts and register each plugin's
// PluginUI contribution into pluginHost. Called once from main.tsx
// before <App /> renders.

import { pluginHost } from "./registry.js";
import { plugins } from "../../modules.config.js";
import type { PluginUI } from "@boringos/ui";

export async function bootPlugins(): Promise<void> {
  for (const entry of plugins) {
    try {
      const mod = await entry.load();
      const exportName = entry.exportName ?? "default";
      const ui = (mod as Record<string, unknown>)[exportName] as PluginUI | undefined;
      if (!ui) {
        // eslint-disable-next-line no-console
        console.warn(
          `[plugin-bootstrap] export "${exportName}" not found on plugin module:`,
          Object.keys(mod),
        );
        continue;
      }
      pluginHost.register(ui);
      // eslint-disable-next-line no-console
      console.info(`[plugin-bootstrap] registered ${ui.moduleId} (${ui.navItems?.length ?? 0} nav items)`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[plugin-bootstrap] failed to load plugin:`, e);
    }
  }
}
