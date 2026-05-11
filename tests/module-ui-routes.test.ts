/**
 * task_22 U4.1 — module UI asset serving.
 *
 * The framework serves a module's prebuilt UI assets at
 * `/modules/:id/ui/*` so the shell can dynamic-`import()` them at
 * runtime. This test boots the framework, uploads the CRM
 * `.hebbsmod` (which now ships a `ui/index.mjs`), and walks every
 * branch of the route:
 *
 *   GET  /modules/crm/ui/index.mjs                 → 200, text/javascript
 *   GET  /modules/crm/ui/../../../etc/passwd       → 400
 *   GET  /modules/nonexistent/ui/anything          → 404
 *   GET  /modules/crm/ui/missing.txt               → 404
 *   GET  /modules/crm/ui/index.mjs (after delete)  → 404
 *
 * The fixture is the same `tests/fixtures/crm-0.2.0.hebbsmod` the
 * upload test uses; this test goes through the public upload
 * endpoint so the on-disk extract + DB row are exercised end-to-end.
 */
import { describe, it, expect, beforeAll } from "vitest";

describe("task_22 U4.1 — GET /modules/:id/ui/*", () => {
  beforeAll(() => {
    // Stubbed signature verifier requires the dev flag (matches the
    // upload-route test's setup; the fixture is unsigned).
    process.env.HEBBS_DEV_MODULES = "true";
  });

  it(
    "serves UI assets after upload, rejects path traversal, 404s for unknown ids and after delete",
    async () => {
      const { BoringOS, createFrameworkModule, createMemoryModule } = await import(
        "@boringos/core"
      );
      const { mkdtemp, readFile, mkdir, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { randomUUID } = await import("node:crypto");

      const dataDir = await mkdtemp(join(tmpdir(), "boringos-u4-ui-"));
      // Match the upload test's pattern: drop the store inside the
      // repo tree so dynamic-import can resolve `@boringos/*` against
      // node_modules above the bundle's location.
      const storeDir = join(
        process.cwd(),
        ".data",
        `module-ui-store-test-${Date.now()}`,
      );
      process.env.MODULES_STORE_DIR = storeDir;
      await mkdir(storeDir, { recursive: true });

      // U6: CRM no longer imports @hebbs/sdk; the bundle has no proto
      // loader, so no MODULES_STORE_DIR pre-staging is required.

      const jwtSecret = "u4-ui-secret";
      const app = new BoringOS({
        database: { embedded: true, dataDir, port: 5591 },
        drive: { root: join(dataDir, "drive") },
        auth: { secret: jwtSecret },
        queue: { concurrency: 1 },
      });

      app.module(createFrameworkModule);
      app.module(createMemoryModule);

      const server = await app.listen(0);
      try {
        const { tenants } = await import("@boringos/db");
        const db = (server as unknown as { context: { db: import("@boringos/db").Db } })
          .context.db;

        const tenantId = randomUUID();
        await db
          .insert(tenants)
          .values({ id: tenantId, name: "U4 UI Test", slug: `u4-ui-${Date.now()}` })
          .onConflictDoNothing();

        // ── 0. Before upload: GET /modules/crm/ui/... → 404 ──────
        const beforeUploadRes = await fetch(
          `${server.url}/modules/crm/ui/index.mjs`,
        );
        expect(beforeUploadRes.status).toBe(404);

        // ── 1. Upload the fixture ────────────────────────────────
        const fixturePath = join(__dirname, "fixtures", "crm-0.2.0.hebbsmod");
        const bytes = await readFile(fixturePath);
        const form = new FormData();
        form.append(
          "file",
          new Blob([bytes], { type: "application/zip" }),
          "crm-0.2.0.hebbsmod",
        );
        const uploadRes = await fetch(
          `${server.url}/api/admin/modules/upload`,
          {
            method: "POST",
            headers: { "X-Tenant-Id": tenantId },
            body: form,
          },
        );
        expect(uploadRes.status).toBe(201);

        // ── 2. Fetch the UI entry → 200, JS content-type ─────────
        const uiRes = await fetch(`${server.url}/modules/crm/ui/index.mjs`);
        expect(uiRes.status).toBe(200);
        const ct = uiRes.headers.get("content-type") ?? "";
        // Hono's mime util emits `text/javascript` for `.mjs`. Accept
        // either spelling in case future bumps switch to the
        // `application/javascript` synonym.
        expect(
          ct.startsWith("text/javascript") ||
            ct.startsWith("application/javascript"),
        ).toBe(true);
        const body = await uiRes.text();
        expect(body.length).toBeGreaterThan(1000);
        // Spot-check: the CRM PluginUI bundle imports from
        // react/jsx-runtime at the top. If the file content is right,
        // we see that string near the top of the response.
        expect(body.slice(0, 200)).toContain("react/jsx-runtime");

        // Entry should NOT be aggressively cached — it's a stable
        // filename whose contents change on every upload.
        const entryCacheControl = uiRes.headers.get("cache-control") ?? "";
        expect(entryCacheControl).toMatch(/no-cache|must-revalidate/);

        // ── 3. Path traversal — defense-in-depth unit check ─────
        // WHATWG URL parsing (used by both fetch() and the
        // @hono/node-server adapter) resolves `..` segments BEFORE
        // the request hits the router. A raw-TCP probe with literal
        // `..` ends up routed to `/modules/crm/ui/etc/passwd` and
        // 404s on the missing asset, not 400 on traversal. So the
        // HTTP layer protects us "by accident".
        //
        // The handler's own `..` check is still real — it guards
        // against any future adapter that *doesn't* normalise, and
        // against internal callers. We exercise it directly on the
        // exported helper.
        const { resolveModuleUiAssetPath } = await import("@boringos/core");
        expect(resolveModuleUiAssetPath("/tmp/ui", "../../../etc/passwd")).toBeNull();
        expect(resolveModuleUiAssetPath("/tmp/ui", "subdir/../../etc/passwd")).toBeNull();
        expect(resolveModuleUiAssetPath("/tmp/ui", "index.mjs")).toBe(
          "/tmp/ui/index.mjs",
        );
        expect(resolveModuleUiAssetPath("/tmp/ui", "assets/foo.js")).toBe(
          "/tmp/ui/assets/foo.js",
        );

        // ── 4. Unknown module id → 404 ───────────────────────────
        const unknownRes = await fetch(
          `${server.url}/modules/does-not-exist/ui/anything.mjs`,
        );
        expect(unknownRes.status).toBe(404);

        // ── 5. Known module, missing asset → 404 ─────────────────
        const missingRes = await fetch(
          `${server.url}/modules/crm/ui/no-such-file.txt`,
        );
        expect(missingRes.status).toBe(404);

        // ── 6. Delete the module → UI 404s ───────────────────────
        const delRes = await fetch(
          `${server.url}/api/admin/modules/crm?version=0.2.0&force=true`,
          { method: "DELETE", headers: { "X-Tenant-Id": tenantId } },
        );
        expect(delRes.status).toBe(200);

        const afterDeleteRes = await fetch(
          `${server.url}/modules/crm/ui/index.mjs`,
        );
        expect(afterDeleteRes.status).toBe(404);
      } finally {
        await server.close();
        delete process.env.MODULES_STORE_DIR;
        await rm(storeDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    180_000,
  );
});
