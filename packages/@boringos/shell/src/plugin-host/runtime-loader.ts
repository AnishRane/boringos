// SPDX-License-Identifier: BUSL-1.1
//
// task_22 / U4.5 — runtime plugin loader.
//
// The framework serves a module's bundled UI from
//   GET /modules/<id>/ui/index.mjs
// (see `packages/@boringos/core/src/module-ui-routes.ts`). This file
// dynamically imports that entry, finds the `PluginUI` export, and
// registers it with `pluginHost` so its nav items / entity panels /
// settings panels light up immediately — no shell rebuild required.
//
// Browser ES modules are loaded once per URL into the module graph;
// `unloadRuntimePlugin` can't actually evict the JS, but dropping
// the registry entry stops the sidebar/routes from referencing it,
// which is the user-visible side of "uninstall". Re-uploading the
// same module URL bypasses any HTTP cache (server sends
// `Cache-Control: no-cache, must-revalidate` on index.mjs) but the
// browser ESM cache is keyed on URL — for a same-version re-upload
// you may have to reload the page to pick up new bytes. Bumping
// the version invalidates URL-keyed cache automatically (different
// path).

import type { PluginUI } from "@boringos/ui";
import { pluginHost } from "./registry.js";

export interface RuntimeLoadResult {
  moduleId: string;
  loaded: boolean;
  error?: string;
}

/**
 * Camel-case the moduleId so `crm` → `crmUI`, `my-crm` → `myCrmUI`.
 */
function camelize(id: string): string {
  return id
    .split(/[-_]/g)
    .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
    .join("");
}

/**
 * Duck-type a value as a PluginUI: must be an object with a string
 * `moduleId`. We deliberately don't require every optional contribution
 * field — modules that ship only nav items are still valid.
 */
function isPluginUiShape(v: unknown): v is PluginUI {
  return (
    typeof v === "object" &&
    v !== null &&
    "moduleId" in v &&
    typeof (v as { moduleId: unknown }).moduleId === "string"
  );
}

/**
 * Find the PluginUI export on a dynamically-imported module record.
 * Tries (in order): `default`, `<camelId>UI`, `<camelId>`, `<id>`,
 * then any top-level value that smells like a PluginUI. Returns
 * undefined if nothing matches.
 */
function findPluginUiExport(
  mod: Record<string, unknown>,
  moduleId: string,
): PluginUI | undefined {
  const camel = camelize(moduleId);
  const candidates: Array<string> = [
    "default",
    `${camel}UI`,
    camel,
    moduleId,
  ];
  for (const key of candidates) {
    const v = mod[key];
    if (isPluginUiShape(v)) return v;
  }
  for (const v of Object.values(mod)) {
    if (isPluginUiShape(v)) return v;
  }
  return undefined;
}

/**
 * Lazy-load a module's PluginUI from /modules/<id>/ui/index.mjs at
 * runtime. Idempotent — if the module is already registered with
 * pluginHost (id matches), bails out with `loaded: false`. Server
 * sets `Cache-Control: no-cache, must-revalidate` on index.mjs so
 * the HTTP layer doesn't cache stale bytes; the browser ESM cache
 * is URL-keyed and persists for the page lifetime.
 */
export async function loadRuntimePlugin(
  moduleId: string,
): Promise<RuntimeLoadResult> {
  // Already registered? Bail.
  const already = pluginHost.modules.find((m) => m.moduleId === moduleId);
  if (already) return { moduleId, loaded: false };

  const url = `/modules/${encodeURIComponent(moduleId)}/ui/index.mjs`;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.warn(`[runtime-loader] import failed for ${moduleId}: ${error}`);
    return { moduleId, loaded: false, error };
  }

  const ui = findPluginUiExport(mod, moduleId);
  if (!ui) {
    const error = `no PluginUI export found in ${url} (exports: ${Object.keys(
      mod,
    ).join(", ")})`;
    // eslint-disable-next-line no-console
    console.warn(`[runtime-loader] ${error}`);
    return { moduleId, loaded: false, error };
  }

  // Defense against id forgery: the server resolves /modules/<id> on
  // its side, but the bundled UI itself carries a moduleId field that
  // ends up registered with `pluginHost`. Cross-check.
  if (ui.moduleId !== moduleId) {
    const error = `moduleId mismatch: requested "${moduleId}", bundle declares "${ui.moduleId}"`;
    // eslint-disable-next-line no-console
    console.warn(`[runtime-loader] ${error}`);
    return { moduleId, loaded: false, error };
  }

  pluginHost.register(ui);
  // eslint-disable-next-line no-console
  console.info(
    `[runtime-loader] registered ${ui.moduleId} (${ui.navItems?.length ?? 0} nav items)`,
  );
  return { moduleId, loaded: true };
}

/**
 * Bulk loader — iterates over a set of installed module ids,
 * skipping already-loaded ones. Returns per-module results. Runs
 * loads in parallel; an error in one module never blocks another.
 */
export async function syncRuntimePlugins(
  installedIds: Set<string>,
): Promise<RuntimeLoadResult[]> {
  const ids = Array.from(installedIds);
  return Promise.all(ids.map((id) => loadRuntimePlugin(id)));
}

/**
 * Remove a module's UI contribution from `pluginHost`. Doesn't and
 * can't unload the JS — ES modules persist in the browser's module
 * graph for the page lifetime. Drops registry entries so the
 * sidebar/routes stop referencing them on the next render.
 */
export function unloadRuntimePlugin(moduleId: string): void {
  pluginHost.unregister(moduleId);
}
