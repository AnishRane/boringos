/**
 * task_22 U3.1 / U3.3 / U3.5 — module-package upload + delete + audit
 * routes.
 *
 * Boots BoringOS with the framework + memory modules only, then drives
 * the new HTTP surface end-to-end:
 *
 *   POST /api/admin/modules/upload      (multipart file=crm-0.3.0.hebbsmod)
 *   GET  /api/admin/modules/packages
 *   GET  /api/admin/modules
 *   POST /api/admin/modules/crm/install (per-tenant install)
 *   POST /api/tools/crm.contacts.create (dispatch)
 *   DELETE /api/admin/modules/crm?version=0.3.0           → 409
 *   POST /api/admin/modules/crm/uninstall
 *   DELETE /api/admin/modules/crm?version=0.3.0           → 200
 *   re-upload → 201
 *
 * Plus failure paths: non-multipart body 400, bad manifest 400,
 * DELETE without version 400, DELETE unknown id 404.
 */
import { describe, it, expect, beforeAll } from "vitest";

describe("task_22 — POST/DELETE/GET /api/admin/modules/* package routes", () => {
  beforeAll(() => {
    // Stubbed signature verifier requires the dev flag. The test
    // fixture is unsigned, so we run the whole suite with this set.
    process.env.HEBBS_DEV_MODULES = "true";
  });

  it(
    "uploads a .hebbsmod, installs it for a tenant, dispatches a tool, deletes the package, then re-uploads",
    async () => {
      const { BoringOS, createFrameworkModule, createMemoryModule } = await import(
        "@boringos/core"
      );
      const { signCallbackToken } = await import("@boringos/agent");
      const { mkdtemp, readFile, writeFile, mkdir, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { randomUUID } = await import("node:crypto");

      const dataDir = await mkdtemp(join(tmpdir(), "boringos-u3-upload-"));
      // The dynamic-import path needs `@boringos/*` resolution from
      // the bundle's location (the bundle marks them external). Node
      // walks up from the file's parent dir hunting for `node_modules`,
      // so we drop the store inside the repo tree rather than /tmp.
      // Keep it under .data/ + a uuid suffix so test runs don't clash.
      const storeDir = join(
        process.cwd(),
        ".data",
        `module-store-test-${Date.now()}`,
      );
      process.env.MODULES_STORE_DIR = storeDir;
      await mkdir(storeDir, { recursive: true });

      // U6: CRM no longer imports @hebbs/sdk, so the .hebbsmod bundle
      // contains no proto loader. No pre-staging required — the upload
      // path is expected to succeed on a clean MODULES_STORE_DIR.

      const jwtSecret = "u3-upload-secret";
      const app = new BoringOS({
        database: { embedded: true, dataDir, port: 5590 },
        drive: { root: join(dataDir, "drive") },
        auth: { secret: jwtSecret },
        queue: { concurrency: 1 },
      });

      app.module(createFrameworkModule);
      app.module(createMemoryModule);

      const server = await app.listen(0);
      try {
        const { tenants, agents, modulePackages } = await import("@boringos/db");
        const { sql, eq, and } = await import("drizzle-orm");
        const db = (server as unknown as { context: { db: import("@boringos/db").Db } })
          .context.db;

        const tenantId = randomUUID();
        const agentId = randomUUID();
        const runId = randomUUID();
        await db
          .insert(tenants)
          .values({ id: tenantId, name: "U3 Test", slug: `u3-${Date.now()}` })
          .onConflictDoNothing();
        await db.insert(agents).values({
          id: agentId,
          tenantId,
          name: "U3 Agent",
          role: "general",
        });

        const fixturePath = join(__dirname, "fixtures", "crm-0.3.0.hebbsmod");
        const bytes = await readFile(fixturePath);

        // ── 1. Non-multipart body → 400 ─────────────────────────
        const badBodyRes = await fetch(
          `${server.url}/api/admin/modules/upload`,
          {
            method: "POST",
            headers: { "X-Tenant-Id": tenantId, "Content-Type": "application/json" },
            body: JSON.stringify({ hello: "world" }),
          },
        );
        expect(badBodyRes.status).toBe(400);
        const badBodyJson = (await badBodyRes.json()) as { error?: { code?: string } };
        expect(badBodyJson.error?.code).toBe("invalid_input");

        // ── 2. Upload the fixture ───────────────────────────────
        const form = new FormData();
        form.append(
          "file",
          new Blob([bytes], { type: "application/zip" }),
          "crm-0.3.0.hebbsmod",
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
        const uploadBody = (await uploadRes.json()) as {
          ok: boolean;
          id: string;
          version: string;
          kind: string;
          contentHash: string;
          toolsAdded: number;
          skillsAdded: number;
          storePath: string;
        };
        expect(uploadBody.ok).toBe(true);
        expect(uploadBody.id).toBe("crm");
        expect(uploadBody.version).toBe("0.3.0");
        expect(uploadBody.toolsAdded).toBeGreaterThan(0);
        expect(uploadBody.storePath).toContain("crm@0.3.0");

        // ── 3. module_packages row persisted ────────────────────
        const pkgRows = await db
          .select()
          .from(modulePackages)
          .where(
            and(
              eq(modulePackages.id, "crm"),
              eq(modulePackages.version, "0.3.0"),
            ),
          );
        expect(pkgRows.length).toBe(1);
        expect(pkgRows[0].contentHash).toBe(uploadBody.contentHash);

        // ── 4. GET /packages lists it ───────────────────────────
        const listRes = await fetch(
          `${server.url}/api/admin/modules/packages`,
          { headers: { "X-Tenant-Id": tenantId } },
        );
        expect(listRes.status).toBe(200);
        const listBody = (await listRes.json()) as {
          packages: Array<{ id: string; version: string }>;
        };
        expect(listBody.packages.some((p) => p.id === "crm" && p.version === "0.3.0")).toBe(
          true,
        );

        // ── 5. GET /api/admin/modules now includes crm ──────────
        const modsRes = await fetch(`${server.url}/api/admin/modules`, {
          headers: { "X-Tenant-Id": tenantId },
        });
        const modsBody = (await modsRes.json()) as {
          modules: Array<{ id: string }>;
        };
        expect(modsBody.modules.some((m) => m.id === "crm")).toBe(true);

        // ── 6. Install + dispatch ───────────────────────────────
        const installRes = await fetch(
          `${server.url}/api/admin/modules/crm/install`,
          {
            method: "POST",
            headers: {
              "X-Tenant-Id": tenantId,
              "Content-Type": "application/json",
            },
            body: "{}",
          },
        );
        expect(installRes.status).toBe(200);
        const installBody = (await installRes.json()) as { ok: boolean };
        expect(installBody.ok).toBe(true);

        const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);
        const dispatchRes = await fetch(
          `${server.url}/api/tools/crm.contacts.create`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              firstName: "Ada",
              lastName: "Lovelace",
              email: "ada@example.com",
            }),
          },
        );
        expect(dispatchRes.status).toBe(200);

        // ── 7. DELETE while installed → 409 ─────────────────────
        const delInstalledRes = await fetch(
          `${server.url}/api/admin/modules/crm?version=0.3.0`,
          { method: "DELETE", headers: { "X-Tenant-Id": tenantId } },
        );
        expect(delInstalledRes.status).toBe(409);
        const delInstalledBody = (await delInstalledRes.json()) as {
          error?: { code?: string; tenants?: string[] };
        };
        expect(delInstalledBody.error?.code).toBe("installed");
        expect(delInstalledBody.error?.tenants?.includes(tenantId)).toBe(true);

        // ── 8. Uninstall, then DELETE → 200 ─────────────────────
        const uninstallRes = await fetch(
          `${server.url}/api/admin/modules/crm/uninstall`,
          {
            method: "POST",
            headers: {
              "X-Tenant-Id": tenantId,
              "Content-Type": "application/json",
            },
            body: "{}",
          },
        );
        expect(uninstallRes.status).toBe(200);

        const delRes = await fetch(
          `${server.url}/api/admin/modules/crm?version=0.3.0`,
          { method: "DELETE", headers: { "X-Tenant-Id": tenantId } },
        );
        expect(delRes.status).toBe(200);
        const delBody = (await delRes.json()) as {
          ok: boolean;
          toolsRemoved: number;
          restartRecommended: boolean;
        };
        expect(delBody.ok).toBe(true);
        expect(delBody.toolsRemoved).toBeGreaterThan(0);
        expect(delBody.restartRecommended).toBe(true);

        // module_packages row gone, store dir gone.
        const pkgsAfter = await db
          .select()
          .from(modulePackages)
          .where(eq(modulePackages.id, "crm"));
        expect(pkgsAfter.length).toBe(0);

        const modsAfter = (await (
          await fetch(`${server.url}/api/admin/modules`, {
            headers: { "X-Tenant-Id": tenantId },
          })
        ).json()) as { modules: Array<{ id: string }> };
        expect(modsAfter.modules.some((m) => m.id === "crm")).toBe(false);

        // Tool dispatch now returns either permission_denied (when
        // the install row is also gone) or 404 (when the tool is no
        // longer in the registry). Either is fine — the contract is
        // "no tools dispatch after delete".
        const postDelDispatch = await fetch(
          `${server.url}/api/tools/crm.contacts.create`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              firstName: "Grace",
              lastName: "Hopper",
              email: "grace@example.com",
            }),
          },
        );
        expect([403, 404]).toContain(postDelDispatch.status);

        // ── 9. DELETE without version → 400 ─────────────────────
        const noVersionRes = await fetch(
          `${server.url}/api/admin/modules/crm`,
          { method: "DELETE", headers: { "X-Tenant-Id": tenantId } },
        );
        expect(noVersionRes.status).toBe(400);

        // ── 10. DELETE unknown id → 404 ─────────────────────────
        const unknownRes = await fetch(
          `${server.url}/api/admin/modules/does-not-exist?version=9.9.9`,
          { method: "DELETE", headers: { "X-Tenant-Id": tenantId } },
        );
        expect(unknownRes.status).toBe(404);

        // ── 11. Re-upload same bytes → 201 ──────────────────────
        const form2 = new FormData();
        form2.append(
          "file",
          new Blob([bytes], { type: "application/zip" }),
          "crm-0.3.0.hebbsmod",
        );
        const reUploadRes = await fetch(
          `${server.url}/api/admin/modules/upload`,
          {
            method: "POST",
            headers: { "X-Tenant-Id": tenantId },
            body: form2,
          },
        );
        expect(reUploadRes.status).toBe(201);
        const reUploadBody = (await reUploadRes.json()) as { id: string };
        expect(reUploadBody.id).toBe("crm");

        // ── 12. Bad manifest (id with uppercase) → 400 ──────────
        const badZipDir = await mkdtemp(join(tmpdir(), "bad-hebbsmod-"));
        await mkdir(badZipDir, { recursive: true });
        await writeFile(
          join(badZipDir, "module.json"),
          JSON.stringify({ id: "BAD_ID", version: "0.0.1", kind: "module" }),
        );
        await writeFile(
          join(badZipDir, "index.mjs"),
          "export default { id: 'BAD_ID', name: 'bad', version: '0.0.1' };",
        );
        const AdmZip = (await import("adm-zip")).default;
        const badZip = new AdmZip();
        badZip.addLocalFolder(badZipDir);
        const badBytes = badZip.toBuffer();
        await rm(badZipDir, { recursive: true, force: true });

        const badForm = new FormData();
        badForm.append(
          "file",
          new Blob([badBytes], { type: "application/zip" }),
          "bad.hebbsmod",
        );
        const badUploadRes = await fetch(
          `${server.url}/api/admin/modules/upload`,
          {
            method: "POST",
            headers: { "X-Tenant-Id": tenantId },
            body: badForm,
          },
        );
        expect(badUploadRes.status).toBe(400);
        const badUploadBody = (await badUploadRes.json()) as { error?: { code?: string } };
        expect(badUploadBody.error?.code).toBe("invalid_manifest");

        // Silence the unused sql warning (used implicitly elsewhere
        // in test patterns).
        void sql;
      } finally {
        await server.close();
        delete process.env.MODULES_STORE_DIR;
        await rm(storeDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    180_000,
  );
});
