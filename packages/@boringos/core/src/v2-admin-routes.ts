// SPDX-License-Identifier: MIT
//
// v2 admin routes — read-only views for the browser shell.
// Phase 10 of task_12.
//
// Mounts under `/api/admin/v2/*`. Auth resolves via the standard
// admin auth middleware (API key OR session token + tenantId
// header). The shell uses these to render the Modules screen and
// the Tool calls audit log.

import { Hono } from "hono";
import { eq, desc, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { toolCalls } from "@boringos/db";
import type { ToolRegistry, SkillRegistry } from "@boringos/agent";
import type { Module } from "@boringos/module-sdk";

interface AdminAuthEnv {
  Variables: {
    tenantId?: string;
  };
}

export interface V2AdminRoutesDeps {
  db: Db;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  modules: readonly Module[];
  /**
   * Reads the auth context. Reuses the host's existing admin
   * auth pattern: API-key clients send `X-Tenant-Id`; browser
   * clients send a Bearer session token resolved by middleware
   * to `X-Tenant-Id` upstream.
   */
  resolveTenantId: (req: Request) => string | null;
}

export function createV2AdminRoutes(deps: V2AdminRoutesDeps): Hono<AdminAuthEnv> {
  const app = new Hono<AdminAuthEnv>();

  // GET /modules — list registered Modules with their tool +
  // skill counts. Read-only across tenants because the registry
  // itself is host-global. Per-tenant install state (when wired
  // in Phase 10 follow-up) overlays this.
  app.get("/modules", (c) => {
    const out = deps.modules.map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description,
      provides: m.provides ?? [],
      dependsOn: m.dependsOn ?? [],
      tools: deps.toolRegistry
        .listByModule(m.id)
        .map((t) => ({ name: t.fullName, description: t.tool.description })),
      skills: deps.skillRegistry
        .listByModule(m.id)
        .map((s) => ({ id: s.skill.id, source: s.skill.source, priority: s.skill.priority })),
    }));
    return c.json({ modules: out });
  });

  // GET /tools — flat list of every registered tool, useful for
  // the catalog browser screen.
  app.get("/tools", (c) => {
    const out = deps.toolRegistry.list().map((t) => ({
      fullName: t.fullName,
      moduleId: t.moduleId,
      description: t.tool.description,
      idempotency: t.tool.idempotency,
      costHint: t.tool.costHint,
    }));
    return c.json({ tools: out });
  });

  // GET /tool-calls — audit log for the current tenant.
  app.get("/tool-calls", async (c) => {
    const tenantId = deps.resolveTenantId(c.req.raw);
    if (!tenantId) {
      return c.json({ error: "Tenant id required" }, 401);
    }
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
    const tool = c.req.query("tool");
    const where = tool
      ? and(eq(toolCalls.tenantId, tenantId), eq(toolCalls.toolName, tool))
      : eq(toolCalls.tenantId, tenantId);
    const rows = await deps.db
      .select()
      .from(toolCalls)
      .where(where)
      .orderBy(desc(toolCalls.startedAt))
      .limit(limit);
    return c.json({ toolCalls: rows });
  });

  return app;
}
