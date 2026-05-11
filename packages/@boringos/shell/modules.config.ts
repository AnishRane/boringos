// SPDX-License-Identifier: BUSL-1.1
//
// External plugins co-bundled with the shell. Each entry imports
// the plugin's web package and registers its `PluginUI` contribution
// at shell boot (see `src/plugin-host/boot.ts`).
//
// To add a plugin:
//   1. `pnpm add <pkg>` in this workspace (or add a workspace link)
//   2. Add an entry below importing its `PluginUI` export
//
// To remove: delete the entry; rebuild.
//
// Future runtime-federation distribution will replace this file
// with dynamic imports driven by /api/admin/modules.

import type { PluginUI } from "@boringos/ui";

export interface PluginEntry {
  /** Loader returning the `PluginUI` export. Use a dynamic import for code-splitting. */
  load: () => Promise<{ default?: PluginUI } & Record<string, PluginUI | unknown>>;
  /** Name of the export carrying the PluginUI (default: "default"). */
  exportName?: string;
}

export const plugins: PluginEntry[] = [
  {
    load: () => import("@boringos-crm/web"),
    exportName: "crmUI",
  },
];
