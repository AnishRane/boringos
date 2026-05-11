// SPDX-License-Identifier: BUSL-1.1
//
// Static plugins co-bundled at build time. Used for development of
// modules that haven't been packaged into `.hebbsmod` yet — useful
// when iterating locally without rebuilding the bundle for every
// edit.
//
// Modules uploaded via the Apps screen are loaded at runtime by
// `RuntimePluginsLoader` instead (see
// `src/plugin-host/RuntimePluginsLoader.tsx`), reading from
// `/modules/<id>/ui/index.mjs`. That is the production path.
//
// To add a *build-time* plugin (dev only):
//   1. `pnpm add <pkg>` in this workspace (or add a workspace link).
//   2. Add an entry below importing its `PluginUI` export.
//
// After packaging into `.hebbsmod`, remove the static entry and
// rely on upload — runtime registration takes precedence and
// re-registering with the same id is a no-op (last-write-wins).

import type { PluginUI } from "@boringos/ui";

export interface PluginEntry {
  /** Loader returning the `PluginUI` export. Use a dynamic import for code-splitting. */
  load: () => Promise<{ default?: PluginUI } & Record<string, PluginUI | unknown>>;
  /** Name of the export carrying the PluginUI (default: "default"). */
  exportName?: string;
}

export const plugins: PluginEntry[] = [
  // Empty by default. CRM is uploaded as a `.hebbsmod` (task_22).
];
