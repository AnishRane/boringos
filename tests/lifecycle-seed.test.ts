// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T7.1 — declarative + imperative seeding.
//
// The seeder fixture declares one agent / workflow / routine at the
// manifest level (declarative path) and seeds a second agent from
// `onInstall` via `Lifecycle.seed` (imperative path). After install
// we expect:
//   - agents:    2 rows, both with source = `module:seeder`
//   - workflows: 1 row,   with type   = `module:seeder`
//   - routines:  1 row,   with title  = "Seeder Auto Routine"
//
// Re-installing the same module must not duplicate rows (idempotency).

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { agents, workflows, routines } from "@boringos/db";
import { createDevHost } from "@boringos/dev-host";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "seeder-module",
);

describe("MDK T7.1 — Lifecycle.seed + declarative auto-seed", () => {
  it("seeds declarative agents/workflows/routines AND honours Lifecycle.seed from onInstall", async () => {
    if (!existsSync(fixturePath)) {
      console.warn("[lifecycle-seed] skipping — seeder fixture missing");
      return;
    }
    process.env.HEBBS_DEV_MODULES = "true";

    const host = await createDevHost({ modulePath: fixturePath });
    try {
      const tenantId = host.tenantId;

      const agentRows = await host.db
        .select()
        .from(agents)
        .where(
          and(eq(agents.tenantId, tenantId), eq(agents.sourceAppId, "seeder")),
        );
      expect(agentRows.map((r) => r.name).sort()).toEqual(
        ["Seeder Auto Agent", "Seeder Imperative Agent"].sort(),
      );

      const wfRows = await host.db
        .select()
        .from(workflows)
        .where(
          and(
            eq(workflows.tenantId, tenantId),
            eq(workflows.type, "module:seeder"),
          ),
        );
      expect(wfRows.map((r) => r.name)).toEqual(["Seeder Auto Workflow"]);

      const routineRows = await host.db
        .select()
        .from(routines)
        .where(
          and(
            eq(routines.tenantId, tenantId),
            eq(routines.title, "Seeder Auto Routine"),
          ),
        );
      expect(routineRows.length).toBe(1);
      expect(routineRows[0].cronExpression).toBe("0 9 * * *");
    } finally {
      await host.close();
    }
  }, 120_000);

  it("re-seeding via Lifecycle.seed is idempotent on (tenantId, source, name)", async () => {
    if (!existsSync(fixturePath)) return;
    process.env.HEBBS_DEV_MODULES = "true";

    const host = await createDevHost({ modulePath: fixturePath });
    try {
      const tenantId = host.tenantId;

      // The first install (during createDevHost) already ran the
      // declarative + imperative seeds. Run reload() to trigger a
      // second register/install cycle and confirm no duplicates.
      await host.reload();

      const agentRows = await host.db
        .select()
        .from(agents)
        .where(
          and(eq(agents.tenantId, tenantId), eq(agents.sourceAppId, "seeder")),
        );
      expect(agentRows.length).toBe(2); // not 4

      const wfRows = await host.db
        .select()
        .from(workflows)
        .where(
          and(
            eq(workflows.tenantId, tenantId),
            eq(workflows.type, "module:seeder"),
          ),
        );
      expect(wfRows.length).toBe(1);
    } finally {
      await host.close();
    }
  }, 120_000);
});
