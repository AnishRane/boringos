// SPDX-License-Identifier: BUSL-1.1
//
// task_22 / U4.5 — RuntimePluginsLoader.
//
// Mounted inside <App> once auth + the BoringOS client are
// available. Watches `useInstalledModules()` and SSE bus to keep
// the in-shell pluginHost in sync with the host's `module_packages`
// + `module_installs` state.
//
// Render-side: returns null. Side effects only.

import { useEffect } from "react";
import { useInstalledModules, useInstallEventSync, useRealtimeEvent } from "@boringos/ui";
import {
  loadRuntimePlugin,
  syncRuntimePlugins,
  unloadRuntimePlugin,
} from "./runtime-loader.js";

export function RuntimePluginsLoader(): null {
  // Subscribe to module:installed / module:uninstalled SSE events
  // and invalidate the react-query ["installs"] cache. Without this,
  // clicking Install in the Apps screen wouldn't propagate to the
  // sidebar / route tree until a full page reload — the upstream
  // useInstalledModules() hook would keep serving the cached
  // "not installed" set forever.
  useInstallEventSync();

  const installed = useInstalledModules();

  // Initial sync + any time the installed set changes (install /
  // uninstall events invalidate the ["installs"] react-query key
  // upstream of this hook).
  useEffect(() => {
    syncRuntimePlugins(installed).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[RuntimePluginsLoader] syncRuntimePlugins:", e);
    });
  }, [installed]);

  // Re-load the bundle when a fresh `.hebbsmod` is uploaded. The
  // ID matches an installed module? Reload. Otherwise: the upload
  // is for a module not yet installed for this tenant — install
  // will trigger its own load via the installed-set effect above.
  useRealtimeEvent("module:uploaded", (e) => {
    const id = e.data.moduleId as string | undefined;
    if (id && installed.has(id)) {
      // Drop the old registration so loadRuntimePlugin doesn't
      // bail on the "already registered" guard. The new import()
      // for the same URL is browser-ESM-cached, but bumping the
      // module's version path or page reload picks up new bytes.
      unloadRuntimePlugin(id);
      loadRuntimePlugin(id).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[RuntimePluginsLoader] re-load ${id}:`, err);
      });
    }
  });

  useRealtimeEvent("module:deleted", (e) => {
    const id = e.data.moduleId as string | undefined;
    if (id) unloadRuntimePlugin(id);
  });

  return null;
}
