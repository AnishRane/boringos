// SPDX-License-Identifier: GPL-3.0-or-later
//
// Hook returning the install-gated list of dashboard widgets every
// registered module contributes. Subscribes to pluginHost so widgets
// appear/disappear when modules are installed or uninstalled without
// a page refresh — same pattern as Sidebar.

import { useSyncExternalStore } from "react";
import { useInstalledModules } from "@boringos/ui";
import type { DashboardWidget } from "@boringos/ui";
import { pluginHost } from "./registry.js";

export function useDashboardWidgets(): Array<DashboardWidget & { moduleId: string }> {
  const installed = useInstalledModules();
  useSyncExternalStore(pluginHost.subscribe, pluginHost.getSnapshot);
  return pluginHost.dashboardWidgets.filter((w) => installed.has(w.moduleId));
}
