/**
 * Phase 15 Smoke Tests — Drive Features
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDbConfig } from "./_helpers.js";

const KEY = "drive-admin";

describe("drive features", () => {
  it("drive skill revisions via admin API", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { generateId } = await import("@boringos/shared");
    const { tenants } = await import("@boringos/db");

    const d = await mkdtemp(join(tmpdir(), "boringos-drive-"));
    const server = await new BoringOS({
      database: testDbConfig(d, 5575),
      drive: { root: join(d, "drive") },
      auth: { secret: "s", adminKey: KEY },
    }).listen(0);

    try {
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Drive Co", slug: "drive-co" });

      const h = { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tid };

      // Update drive skill (creates first revision)
      await fetch(`${server.url}/api/admin/drive/skill`, {
        method: "PATCH", headers: h,
        body: JSON.stringify({ content: "# Drive Rules v1\n\nOrganize by project.", changedBy: "user" }),
      });

      // Update again (creates second revision)
      await fetch(`${server.url}/api/admin/drive/skill`, {
        method: "PATCH", headers: h,
        body: JSON.stringify({ content: "# Drive Rules v2\n\nOrganize by date.", changedBy: "agent" }),
      });

      // Get current skill
      const skillRes = await fetch(`${server.url}/api/admin/drive/skill`, { headers: h });
      const skill = await skillRes.json() as { skill: string };
      expect(skill.skill).toContain("v2");

      // List revisions
      const revRes = await fetch(`${server.url}/api/admin/drive/skill/revisions`, { headers: h });
      const revs = await revRes.json() as { revisions: Array<{ changedBy: string }> };
      expect(revs.revisions).toHaveLength(2);
    } finally { await server.close(); }
  }, 30000);

  it("DriveManager writes file and indexes in DB", async () => {
    const { createLocalStorage, createDriveManager } = await import("@boringos/drive");
    const { createDatabase, createMigrationManager, driveFiles } = await import("@boringos/db");
    const { eq } = await import("drizzle-orm");

    const d = await mkdtemp(join(tmpdir(), "boringos-drvmgr-"));
    const conn = await createDatabase(testDbConfig(join(d, "pg"), 5574));
    await createMigrationManager(conn.db).apply();

    const { tenants } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const tid = generateId();
    await conn.db.insert(tenants).values({ id: tid, name: "DM Test", slug: "dm-test" });

    const storage = createLocalStorage({ root: join(d, "drive") });
    const manager = createDriveManager({ storage, db: conn.db, tenantId: tid });

    // Write a file
    const record = await manager.write("docs/readme.md", "# Hello\n\nThis is a test.");
    expect(record.filename).toBe("readme.md");
    expect(record.format).toBe("md");
    expect(record.size).toBeGreaterThan(0);
    expect(record.hash).toBeTruthy();

    // Read it back
    const content = await manager.read("docs/readme.md");
    expect(content).toContain("Hello");

    // List files from DB
    const files = await manager.list();
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("docs/readme.md");

    // Verify DB row
    const rows = await conn.db.select().from(driveFiles).where(eq(driveFiles.tenantId, tid));
    expect(rows).toHaveLength(1);

    await conn.close();
  }, 30000);

  it("/drive/list reconciles FS files that bypassed the index (drive_issues #4)", async () => {
    const { BoringOS, reconcileDriveIndex } = await import("@boringos/core");
    const { createLocalStorage } = await import("@boringos/drive");
    const { generateId } = await import("@boringos/shared");
    const { tenants, driveFiles } = await import("@boringos/db");
    const { eq, and } = await import("drizzle-orm");

    const d = await mkdtemp(join(tmpdir(), "boringos-reconcile-"));
    const driveRoot = join(d, "drive");
    const server = await new BoringOS({
      database: testDbConfig(d, 5576),
      drive: { root: driveRoot },
      auth: { secret: "s", adminKey: KEY },
    }).listen(0);

    try {
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Reconcile Co", slug: "reconcile-co" });
      const h = { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tid };

      // Simulate the bypass writers: write straight to the FS through a
      // raw storage backend (no DriveManager → no index row), the same
      // way the checkpoint hook appends a task log and an agent FS-writes
      // a non-memory shared file.
      const storage = createLocalStorage({ root: driveRoot });
      await storage.write(`${tid}/tasks/BOS-1/log.md`, "# Run log\n\nfirst entry\n");
      await storage.write(`${tid}/shared/playbooks/onboarding.md`, "# Onboarding playbook\n");
      // A dotfile that must NOT be indexed (parity with DriveManager).
      await storage.write(`${tid}/.drive-skill.md`, "# skill\n");

      // Before reconcile, the index knows nothing.
      const pre = await db.select().from(driveFiles).where(eq(driveFiles.tenantId, tid));
      expect(pre).toHaveLength(0);

      // The list endpoint reconciles first, so both bypassed files appear.
      const listRes = await fetch(`${server.url}/api/admin/drive/list`, { headers: h });
      const list = await listRes.json() as { files: Array<{ path: string; size: number }> };
      const paths = list.files.map((f) => f.path).sort();
      expect(paths).toContain("tasks/BOS-1/log.md");
      expect(paths).toContain("shared/playbooks/onboarding.md");
      expect(paths).not.toContain(".drive-skill.md");

      // Stale-size refresh: append to the log (FS grows), reconcile, and
      // confirm the index size tracks disk rather than staying frozen.
      const logRow1 = (await db.select().from(driveFiles)
        .where(and(eq(driveFiles.tenantId, tid), eq(driveFiles.path, "tasks/BOS-1/log.md"))).limit(1))[0];
      const sizeBefore = logRow1.size;

      await storage.write(`${tid}/tasks/BOS-1/log.md`, "# Run log\n\nfirst entry\nsecond entry appended\n");
      const result = await reconcileDriveIndex({ db, drive: storage }, tid);
      expect(result.updated).toBeGreaterThanOrEqual(1);

      const logRow2 = (await db.select().from(driveFiles)
        .where(and(eq(driveFiles.tenantId, tid), eq(driveFiles.path, "tasks/BOS-1/log.md"))).limit(1))[0];
      expect(logRow2.size).toBeGreaterThan(sizeBefore);

      // Idempotent: a no-op reconcile inserts/updates nothing.
      const again = await reconcileDriveIndex({ db, drive: storage }, tid);
      expect(again.inserted).toBe(0);
      expect(again.updated).toBe(0);
    } finally { await server.close(); }
  }, 30000);
});
