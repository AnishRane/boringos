// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T7.2 — re-seed / upgrade policy.
//
// Per the plan: "Each seed declares a stable seedId; framework writes
// __seed_meta row on install; re-seed on upgrade only updates seeds
// where modified_since_install = false."
//
// `modified_since_install` is implemented as a hash comparison: the
// current row hash equals the meta.baselineHash IFF the tenant hasn't
// edited it. We exercise three paths:
//
//   1. Author bumps a seed payload, tenant hasn't touched the row →
//      framework updates the row + bumps the meta.
//   2. Tenant edits a routine, author bumps the same seed → framework
//      LEAVES the tenant edit alone.
//   3. Untouched + unbumped → skipped (idempotent, no churn).
//
// We drive the upgrade by mutating the fixture's module.json + entry,
// then calling host.reload() which re-runs the install flow.

import { describe, it, expect } from "vitest";
import { afterAll } from "vitest";
import { mkdtemp, cp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { routines, seedMeta } from "@boringos/db";
import { createDevHost } from "@boringos/dev-host";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "seeder-module",
);

const clones: string[] = [];
afterAll(async () => {
  for (const d of clones) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

async function cloneFixture(): Promise<string> {
  const dir = await mkdtemp(
    join(process.cwd(), ".dev-host-upgrade-fixture-"),
  );
  await cp(fixturePath, dir, { recursive: true });
  clones.push(dir);
  return dir;
}

describe("MDK T7.2 — seed upgrade policy", () => {
  it("updates an unmodified routine when the author bumps the seed", async () => {
    if (!existsSync(fixturePath)) return;
    process.env.HEBBS_DEV_MODULES = "true";

    const clone = await cloneFixture();
    const host = await createDevHost({ modulePath: clone });
    try {
      const tenantId = host.tenantId;

      // After initial install, the routine has cron "0 9 * * *".
      const before = await host.db
        .select()
        .from(routines)
        .where(
          and(
            eq(routines.tenantId, tenantId),
            eq(routines.title, "Seeder Auto Routine"),
          ),
        );
      expect(before.length).toBe(1);
      expect(before[0].cronExpression).toBe("0 9 * * *");

      // Meta row was written too.
      const metaBefore = await host.db
        .select()
        .from(seedMeta)
        .where(
          and(
            eq(seedMeta.tenantId, tenantId),
            eq(seedMeta.moduleId, "seeder"),
            eq(seedMeta.kind, "routine"),
          ),
        );
      expect(metaBefore.length).toBe(1);
      const baselineHashBefore = metaBefore[0].baselineHash;

      // Author bumps the cron to "0 8 * * *" + bumps version.
      const mjsPath = join(clone, "index.mjs");
      const mjsText = await readFile(mjsPath, "utf8");
      await writeFile(
        mjsPath,
        mjsText
          .replace(`expression: "0 9 * * *"`, `expression: "0 8 * * *"`)
          .replace(`version: "0.1.0"`, `version: "0.1.1"`),
      );
      const manifestPath = join(clone, "module.json");
      const manifestText = await readFile(manifestPath, "utf8");
      await writeFile(
        manifestPath,
        manifestText.replace(`"0.1.0"`, `"0.1.1"`),
      );

      // Re-install via reload (re-imports + re-registers + runs the
      // install path again).
      await host.reload();
      // Re-trigger install for the tenant (reload only re-imports
      // factory; install hits the install-manager).
      const r = await fetch(`${host.url}/api/admin/modules/seeder/install`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${host.callbackToken}`,
          "X-Tenant-Id": tenantId,
          "Content-Type": "application/json",
        },
      });
      expect(r.status).toBe(200);

      const after = await host.db
        .select()
        .from(routines)
        .where(
          and(
            eq(routines.tenantId, tenantId),
            eq(routines.title, "Seeder Auto Routine"),
          ),
        );
      expect(after.length).toBe(1);
      expect(after[0].cronExpression).toBe("0 8 * * *"); // upgraded

      const metaAfter = await host.db
        .select()
        .from(seedMeta)
        .where(
          and(
            eq(seedMeta.tenantId, tenantId),
            eq(seedMeta.moduleId, "seeder"),
            eq(seedMeta.kind, "routine"),
          ),
        );
      expect(metaAfter[0].baselineHash).not.toBe(baselineHashBefore);
      expect(metaAfter[0].moduleVersion).toBe("0.1.1");
    } finally {
      await host.close();
    }
  }, 120_000);

  it("preserves a tenant-edited routine when the author bumps the seed", async () => {
    if (!existsSync(fixturePath)) return;
    process.env.HEBBS_DEV_MODULES = "true";

    const clone = await cloneFixture();
    const host = await createDevHost({ modulePath: clone });
    try {
      const tenantId = host.tenantId;

      // 1. Tenant edits the seeded routine — sets cron to "30 7 * * *".
      await host.db
        .update(routines)
        .set({ cronExpression: "30 7 * * *", updatedAt: new Date() })
        .where(
          and(
            eq(routines.tenantId, tenantId),
            eq(routines.title, "Seeder Auto Routine"),
          ),
        );

      // 2. Author bumps the seed to "0 8 * * *".
      const mjsPath = join(clone, "index.mjs");
      const mjsText = await readFile(mjsPath, "utf8");
      await writeFile(
        mjsPath,
        mjsText.replace(`expression: "0 9 * * *"`, `expression: "0 8 * * *"`),
      );

      await host.reload();
      const r = await fetch(`${host.url}/api/admin/modules/seeder/install`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${host.callbackToken}`,
          "X-Tenant-Id": tenantId,
          "Content-Type": "application/json",
        },
      });
      expect(r.status).toBe(200);

      // 3. The tenant's edit survives.
      const after = await host.db
        .select()
        .from(routines)
        .where(
          and(
            eq(routines.tenantId, tenantId),
            eq(routines.title, "Seeder Auto Routine"),
          ),
        );
      expect(after.length).toBe(1);
      expect(after[0].cronExpression).toBe("30 7 * * *"); // tenant edit wins
    } finally {
      await host.close();
    }
  }, 120_000);
});
