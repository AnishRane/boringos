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

// task_22 debug instrumentation — every load step also POSTs to the
// framework so we can read it in the dev-server log. Remove once the
// browser-side flow is verified working.
function dbg(stage: string, data: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.info(`[runtime-loader] ${stage}`, data);
  try {
    fetch("/api/debug/runtime-loader", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, ...data, at: Date.now() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* fire-and-forget */
  }
}

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
  dbg("loadRuntimePlugin:start", { moduleId });

  // Already registered? Bail.
  const already = pluginHost.modules.find((m) => m.moduleId === moduleId);
  if (already) {
    dbg("loadRuntimePlugin:already-registered", { moduleId });
    return { moduleId, loaded: false };
  }

  const url = `/modules/${encodeURIComponent(moduleId)}/ui/index.mjs`;
  const cssUrl = `/modules/${encodeURIComponent(moduleId)}/ui/index.css`;

  // Probe with a HEAD request first — built-in modules have no UI
  // bundle (404), and we want to skip them silently rather than
  // flood the log with "import failed". Only proceed to the dynamic
  // import when the bundle is actually present.
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.status === 404) {
      dbg("loadRuntimePlugin:no-ui-bundle", { moduleId });
      return { moduleId, loaded: false };
    }
  } catch {
    // Network error during HEAD — let the import attempt below
    // produce the real diagnostic.
  }

  // CSS sidecar — Vite library mode emits the bundle's stylesheet
  // as a separate file (the JS bundle has no `<style>` blocks).
  // If the module ships one, inject it as a <link> before the JS
  // runs so styles are applied on first paint. Idempotent: tag
  // the link with a data attribute keyed by moduleId.
  try {
    const cssHead = await fetch(cssUrl, { method: "HEAD" });
    if (cssHead.status === 200) {
      const linkId = `boringos-plugin-css-${moduleId}`;
      if (!document.getElementById(linkId)) {
        const link = document.createElement("link");
        link.id = linkId;
        link.rel = "stylesheet";
        link.href = cssUrl;
        link.setAttribute("data-plugin-module-id", moduleId);
        document.head.appendChild(link);
        dbg("loadRuntimePlugin:css-injected", { moduleId, cssUrl });
      }
    }
  } catch {
    // Missing/inaccessible CSS isn't fatal — many modules ship JS
    // only. Continue.
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
    dbg("loadRuntimePlugin:import-ok", {
      moduleId,
      exportKeys: Object.keys(mod),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    dbg("loadRuntimePlugin:import-failed", { moduleId, error });
    return { moduleId, loaded: false, error };
  }

  const ui = findPluginUiExport(mod, moduleId);
  if (!ui) {
    const error = `no PluginUI export found in ${url} (exports: ${Object.keys(
      mod,
    ).join(", ")})`;
    dbg("loadRuntimePlugin:no-pluginui-export", {
      moduleId,
      exports: Object.keys(mod),
    });
    return { moduleId, loaded: false, error };
  }

  // Defense against id forgery: the server resolves /modules/<id> on
  // its side, but the bundled UI itself carries a moduleId field that
  // ends up registered with `pluginHost`. Cross-check.
  if (ui.moduleId !== moduleId) {
    const error = `moduleId mismatch: requested "${moduleId}", bundle declares "${ui.moduleId}"`;
    dbg("loadRuntimePlugin:moduleid-mismatch", {
      moduleId,
      bundleModuleId: ui.moduleId,
    });
    return { moduleId, loaded: false, error };
  }

  pluginHost.register(ui);
  dbg("loadRuntimePlugin:registered", {
    moduleId: ui.moduleId,
    navItems: ui.navItems?.length ?? 0,
    settingsPanels: ui.settingsPanels?.length ?? 0,
  });
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
  dbg("syncRuntimePlugins:enter", { ids });
  const out = await Promise.all(ids.map((id) => loadRuntimePlugin(id)));
  dbg("syncRuntimePlugins:done", {
    results: out.map((r) => ({ id: r.moduleId, loaded: r.loaded, error: r.error })),
  });
  return out;
}

/**
 * Remove a module's UI contribution from `pluginHost`. Doesn't and
 * can't unload the JS — ES modules persist in the browser's module
 * graph for the page lifetime. Drops registry entries so the
 * sidebar/routes stop referencing them on the next render.
 */
export function unloadRuntimePlugin(moduleId: string): void {
  pluginHost.unregister(moduleId);
  // Drop the injected stylesheet so a re-install doesn't accumulate
  // duplicate <link> tags or keep stale styles applied after the
  // route tree no longer references this module. Guarded for
  // Node-side unit tests that exercise the registry layer without
  // a DOM.
  if (typeof document === "undefined") return;
  const link = document.getElementById(`boringos-plugin-css-${moduleId}`);
  if (link) link.remove();
}
