// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression test for drive_issues.md #13.
//
// The inbox-triage / inbox-replier modules used to gate their install
// handler on a per-tenant `runtimes` row and silently `return` when one
// was absent. Post-`dc748a4` that row never exists on a fresh tenant
// (runtime is host-wide via BORINGOS_RUNTIME), so every new signup got
// NO triage agent, NO triage workflow, NO replier — email triage was
// silently dead. No test exercised the install handler, so it shipped.
//
// This test installs both default modules against a brand-new tenant
// that has NO runtimes row (the table is now an empty compat shim the
// framework never writes) and asserts the agents + workflows are created.

import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";

async function bootServer(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const dataDir = await mkdtemp(join(tmpdir(), "boringos-fresh-tenant-"));
  const app = new BoringOS({
    database: { embedded: true, dataDir, port },
    drive: { root: join(dataDir, "drive") },
    auth: { secret: "test-secret", adminKey: "test-admin-key" },
  });
  return app.listen(0);
}

describe("default inbox modules install on a fresh tenant (drive_issues #13)", () => {
  it("seeds the triage + replier agents and workflows with no runtimes row", async () => {
    const server = await bootServer(5599);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, workflows } = await import("@boringos/db");
      const { createInboxTriageModule, createInboxReplierModule } = await import(
        "@boringos/core"
      );
      const db = server.context.db as import("@boringos/db").Db;

      // Fresh tenant with a root agent for the modules to report under.
      // Deliberately NO runtimes row — that's the whole point of #13.
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Fresh Co", slug: `fresh-${Date.now()}` });
      await db.insert(agents).values({
        id: generateId(),
        tenantId,
        name: "Chief of Staff",
        role: "chief-of-staff",
      });

      // Run the same handler that fires on real signup (onTenantCreate).
      const triage = createInboxTriageModule({ db } as never);
      await triage.lifecycle!.onTenantCreate!({ tenantId, moduleId: "inbox-triage" });
      const replier = createInboxReplierModule({ db } as never);
      await replier.lifecycle!.onTenantCreate!({ tenantId, moduleId: "inbox-replier" });

      // Triage agent + workflow exist.
      const triageAgents = await db
        .select()
        .from(agents)
        .where(and(eq(agents.tenantId, tenantId), eq(agents.name, "Generic Inbox Triage")));
      expect(triageAgents).toHaveLength(1);

      const triageWorkflows = await db
        .select()
        .from(workflows)
        .where(and(eq(workflows.tenantId, tenantId), eq(workflows.name, "Triage incoming inbox items")));
      expect(triageWorkflows).toHaveLength(1);
      expect(triageWorkflows[0].status).toBe("active");

      // Replier agent + workflow exist.
      const replierAgents = await db
        .select()
        .from(agents)
        .where(and(eq(agents.tenantId, tenantId), eq(agents.name, "Generic Email Replier")));
      expect(replierAgents).toHaveLength(1);

      const replierWorkflows = await db
        .select()
        .from(workflows)
        .where(and(eq(workflows.tenantId, tenantId), eq(workflows.name, "Draft generic reply for incoming items")));
      expect(replierWorkflows).toHaveLength(1);
      expect(replierWorkflows[0].status).toBe("active");
    } finally {
      await server.close();
    }
  }, 30000);
});
