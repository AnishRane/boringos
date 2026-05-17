// SPDX-License-Identifier: AGPL-3.0-or-later
//
// task_22 U4.1 — module UI asset serving.
//
// Mounted at `/modules` in `boringos.ts`. Serves the prebuilt UI
// assets that ship inside a `.hebbsmod` bundle (the `ui/` subdir,
// extracted to `<storePath>/ui/` by the upload route) so the shell
// can dynamic-`import()` them at runtime:
//
//   GET /modules/:id/ui/index.mjs        — the PluginUI entry
//   GET /modules/:id/ui/assets/foo-AB.js — hashed chunks / styles
//
// Latest version wins. If a host has crm@0.2.0 AND crm@0.3.0 both
// uploaded, the route serves the most-recent `uploaded_at`. The
// shell never asks for a specific version — it asks for "the UI of
// module X" and the host resolves.
//
// Cache headers:
//   - Hashed assets (`/assets/<name>-<hash>.<ext>`) → 1h public
//     cache. Filename changes on every build, so cached copies are
//     never stale by mistake.
//   - `index.mjs` (the entry) → `no-cache, must-revalidate`. The
//     entry filename is stable; a new upload of the same version
//     needs to be picked up immediately by the browser.
//
// Security:
//   - The route resolves `*` against `<storePath>/ui/` and rejects
//     any path that escapes the directory (path traversal). 400.
//   - Public mount: module UI assets are static and carry no
//     secrets. Gating reads on per-tenant install state would
//     just mean every tenant fetches the same bytes anyway. This
//     matches how WordPress / Shopify plugin UIs work.

import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, normalize, resolve as pathResolve, sep } from "node:path";
import { Readable } from "node:stream";
import { getMimeType } from "hono/utils/mime";
import type { Db } from "@boringos/db";
import { modulePackages } from "@boringos/db";

export interface ModuleUiRoutesDeps {
  db: Db;
}

/**
 * Resolve the on-disk file path for `GET /:id/ui/<rest>`, returning
 * `null` if the rest path escapes the ui root.
 */
function resolveAssetPath(uiRoot: string, restPath: string): string | null {
  // Strip leading slashes — Hono's wildcard captures may or may not
  // include them depending on the matched pattern. `normalize` then
  // collapses `..` segments; we test the result against `uiRoot` to
  // confirm containment.
  const stripped = restPath.replace(/^\/+/, "");
  // Disallow paths that LOOK like they're trying to climb out — we
  // could rely solely on the containment check below, but rejecting
  // here gives us a cleaner 400 with the original path in the error.
  if (stripped === ".." || stripped.startsWith("../") || stripped.includes("/../") || stripped.endsWith("/..")) {
    return null;
  }
  const candidate = pathResolve(uiRoot, stripped);
  const normalizedRoot = normalize(uiRoot.endsWith(sep) ? uiRoot : uiRoot + sep);
  if (candidate !== normalize(uiRoot) && !candidate.startsWith(normalizedRoot)) {
    return null;
  }
  return candidate;
}

/**
 * Pattern-match cache headers for a UI asset path:
 *
 *   - `/assets/<name>-<hash>.<ext>` and similar hashed paths get a
 *     long cache. Vite + Rollup both emit the same shape.
 *   - everything else (including `index.mjs`) gets a no-cache header
 *     so the shell always sees the latest upload.
 */
function cacheControlFor(relPath: string): string {
  // Hashed assets typically live under `/assets/` and embed an 8+
  // char hex/base36 hash before the extension. We're permissive —
  // any path under `assets/` is considered cache-safe.
  if (/^\/?assets\//.test(relPath)) {
    return "public, max-age=3600";
  }
  return "no-cache, must-revalidate";
}

export function createModuleUiRoutes(deps: ModuleUiRoutesDeps): Hono {
  const app = new Hono();

  app.get("/:id/ui/*", async (c) => {
    const id = c.req.param("id");

    // Hono captures the wildcard as the path AFTER `/ui/`. There's
    // no public typed accessor — `c.req.path` gives the full URL
    // path; we slice off the prefix.
    const fullPath = c.req.path;
    const prefix = `/${id}/ui/`;
    // The route is mounted at `/modules`, so `c.req.path` on a
    // matched request looks like `/modules/<id>/ui/<rest>`.
    // `c.req.routePath` would be `/:id/ui/*` — the wildcard match
    // itself isn't exposed cleanly, so we derive it from the URL.
    const idx = fullPath.indexOf(prefix);
    const rest = idx >= 0 ? fullPath.slice(idx + prefix.length) : "";

    if (rest === "") {
      return c.json(
        { ok: false, error: { code: "not_found", message: "ui asset path required" } },
        404,
      );
    }

    // Resolve the latest-uploaded package for this id. If the host
    // hosts multiple versions (re-upload, version bump) we want the
    // newest assets to win — same heuristic as `import-latest`.
    const rows = await deps.db
      .select({ storePath: modulePackages.storePath })
      .from(modulePackages)
      .where(eq(modulePackages.id, id))
      .orderBy(desc(modulePackages.uploadedAt))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json(
        {
          ok: false,
          error: { code: "not_found", message: `Module "${id}" is not uploaded.` },
        },
        404,
      );
    }

    const uiRoot = join(row.storePath, "ui");
    const filePath = resolveAssetPath(uiRoot, rest);
    if (!filePath) {
      return c.json(
        {
          ok: false,
          error: {
            code: "invalid_path",
            message: "Resolved path escapes the module's ui directory.",
          },
        },
        400,
      );
    }

    let st;
    try {
      st = await stat(filePath);
    } catch {
      return c.json(
        {
          ok: false,
          error: { code: "not_found", message: `ui asset not found: ${rest}` },
        },
        404,
      );
    }
    if (!st.isFile()) {
      return c.json(
        {
          ok: false,
          error: { code: "not_found", message: `ui asset not a file: ${rest}` },
        },
        404,
      );
    }

    const mime = getMimeType(filePath) ?? "application/octet-stream";
    const cacheControl = cacheControlFor(rest);

    const nodeStream = createReadStream(filePath);
    // Hono runs on Node's `serve` adapter; a Web ReadableStream
    // wraps the Node stream cleanly.
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(st.size),
        "Cache-Control": cacheControl,
      },
    });
  });

  return app;
}

// Exported for tests.
export { resolveAssetPath, cacheControlFor };
