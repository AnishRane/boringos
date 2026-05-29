// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Install manager — owns the per-tenant install lifecycle.
//
// Responsibilities:
//  - At boot: backfill `module_installs` rows for every existing
//    tenant × every host-registered module that has
//    `defaultInstall !== false`. Idempotent via the unique index.
//  - Per-tenant install/uninstall: insert/delete a row, run the
//    Module's `onInstall(ctx)` / `onUninstall(ctx)` hook.
//  - On new-tenant creation: invoke `onTenantCreate(ctx)` for
//    every default-install module + insert the install row.
//  - Tenant-install check: does (tenant, module) have a row?
//
// Decoupled from HTTP — callers (boringos.ts, admin routes)
// invoke methods directly.

import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import {
  tenants as tenantsTable,
  moduleInstalls,
  moduleMigrations,
  agents as agentsTable,
  workflows as workflowsTable,
  routines as routinesTable,
  runtimes as runtimesTable,
} from "@boringos/db";
import type {
  Migration,
  Module,
  ModuleContext,
  ModuleDb,
  SeedFn,
  SeedPayload,
  SeedResult,
  AgentSeed,
  WorkflowSeed,
  Routine,
} from "@boringos/module-sdk";

export interface InstallManager {
  /** Run at boot: ensure every existing tenant has install rows
   * for every default-install module. Idempotent. */
  backfill(modules: readonly Module[]): Promise<void>;
  /** Install one module for one tenant. Runs `onInstall`, then
   * inserts the row (or updates the version on conflict). */
  install(moduleId: string, tenantId: string): Promise<InstallResult>;
  /** Uninstall one module for one tenant. Runs `onUninstall`,
   * then deletes the row. */
  uninstall(moduleId: string, tenantId: string): Promise<InstallResult>;
  /** Invoke `onTenantCreate` for every module that has the hook
   * declared, and install every default-install module for the
   * new tenant. */
  onTenantCreated(tenantId: string): Promise<void>;
  /** Whether (tenant, module) has an install row. Used by the
   * dispatcher's permission check. If the module is
   * `defaultInstall !== false`, returns true even when no row
   * exists yet, and writes the row lazily — keeps brand-new
   * tenants in sync without forcing them through the boot
   * backfill. Modules with `defaultInstall: false` require an
   * explicit install. */
  isInstalled(moduleId: string, tenantId: string): Promise<boolean>;
  /** List installed modules for a tenant. */
  listForTenant(tenantId: string): Promise<readonly InstalledRow[]>;
}

export interface InstallResult {
  ok: boolean;
  /** Set when the lifecycle hook threw — the row state may have
   * been reverted depending on the operation order. */
  hookError?: string;
}

export interface InstalledRow {
  moduleId: string;
  version: string;
  installedAt: Date;
  config: Record<string, unknown>;
}

export interface InstallManagerDeps {
  db: Db;
  /** All modules the host has registered. The manager looks them
   * up by id when running lifecycle hooks. */
  modules: readonly Module[];
  /**
   * Optional realtime bus reference for emitting module:installed /
   * module:uninstalled events. The shell subscribes via SSE so its
   * sidebar + route gates update without a reload (task_19 Phase C).
   * Typed loose to keep this package free of @boringos/core deps.
   */
  realtimeBus?: {
    publish(event: { type: string; tenantId: string; data: Record<string, unknown>; timestamp: string }): void;
  };
}

export function createInstallManager(deps: InstallManagerDeps): InstallManager {
  // Resolve `deps.modules` on every lookup so post-listen
  // `app.registerModule()` calls (task_22 / U2) are seen by the
  // install manager. Building a Map up-front would freeze the list at
  // construction time and any module added at runtime would be invisible
  // to install / uninstall / isInstalled.
  const getModule = (id: string): Module | undefined =>
    deps.modules.find((m) => m.id === id);

  // Adapt a Drizzle Db to the SDK's loose `ModuleDb` interface so
  // lifecycle hooks can run raw SQL without knowing about Drizzle.
  const moduleDb: ModuleDb = {
    async execute(sqlText: string) {
      // sql.raw is unsafe by design — only the framework's own
      // hooks call this. Module authors should keep DDL in
      // `Module.schema` Migration objects.
      return deps.db.execute(sql.raw(sqlText));
    },
  };

  // MDK T7.1 — Lifecycle.seed implementation. Idempotent on
  // (tenant_id, source = `module:<id>`, name/title). Authors call
  // this from `onInstall` via `Lifecycle.seed(ctx, ...)`; the
  // framework also calls it after `onInstall` returns for any
  // declarative collections on the manifest.
  const seedFor = (mod: Module, tenantId: string): SeedFn => async (payload) => {
    return runSeed(deps.db, mod, tenantId, payload);
  };

  const ctxFor = (mod: Module, tenantId: string): ModuleContext => ({
    tenantId,
    moduleId: mod.id,
    db: moduleDb,
    seed: seedFor(mod, tenantId),
  });

  const writeInstallRow = async (mod: Module, tenantId: string) => {
    await deps.db
      .insert(moduleInstalls)
      .values({
        tenantId,
        moduleId: mod.id,
        version: mod.version,
        config: {},
      })
      .onConflictDoUpdate({
        target: [moduleInstalls.tenantId, moduleInstalls.moduleId],
        set: { version: mod.version, updatedAt: new Date() },
      });
  };

  /**
   * Apply pending Module.schema migrations for (tenant, module).
   * Idempotent: skips migrations whose id is already in
   * `module_migrations`. Records each applied id so a later
   * uninstall can roll them back in reverse order.
   *
   * If a migration's `up()` throws, we rethrow — the caller
   * decides whether to mark install as ok=false. Partial state
   * is OK because the marker row is only written after up()
   * succeeds.
   */
  const applyMigrations = async (mod: Module, tenantId: string): Promise<void> => {
    const migrations = mod.schema ?? [];
    if (migrations.length === 0) return;
    const appliedRows = await deps.db
      .select({ migrationId: moduleMigrations.migrationId })
      .from(moduleMigrations)
      .where(
        and(
          eq(moduleMigrations.tenantId, tenantId),
          eq(moduleMigrations.moduleId, mod.id),
        ),
      );
    const applied = new Set(appliedRows.map((r) => r.migrationId));
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      await migration.up(moduleDb);
      await deps.db.insert(moduleMigrations).values({
        tenantId,
        moduleId: mod.id,
        migrationId: migration.id,
      });
    }
  };

  /**
   * Roll back applied migrations for (tenant, module) in reverse
   * order. Used at uninstall. Tolerates per-migration failures
   * by logging and continuing — module data may be left in a
   * partial state but the operator can drop the namespace
   * tables manually.
   */
  const rollbackMigrations = async (mod: Module, tenantId: string): Promise<void> => {
    const declared = mod.schema ?? [];
    if (declared.length === 0) return;
    const appliedRows = await deps.db
      .select({ migrationId: moduleMigrations.migrationId })
      .from(moduleMigrations)
      .where(
        and(
          eq(moduleMigrations.tenantId, tenantId),
          eq(moduleMigrations.moduleId, mod.id),
        ),
      );
    const applied = new Set(appliedRows.map((r) => r.migrationId));
    // Roll back in reverse declared order. Migrations not
    // declared in the current Module manifest are skipped.
    const toRollBack: Migration[] = [];
    for (let i = declared.length - 1; i >= 0; i -= 1) {
      const m = declared[i];
      if (applied.has(m.id)) toRollBack.push(m);
    }
    for (const migration of toRollBack) {
      try {
        await migration.down(moduleDb);
        await deps.db
          .delete(moduleMigrations)
          .where(
            and(
              eq(moduleMigrations.tenantId, tenantId),
              eq(moduleMigrations.moduleId, mod.id),
              eq(moduleMigrations.migrationId, migration.id),
            ),
          );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          `[install-manager] rollback of ${mod.id}.${migration.id} failed for tenant ${tenantId}:`,
          e,
        );
        // Keep going — best-effort cleanup.
      }
    }
  };

  return {
    async backfill(modules) {
      const tenantRows = await deps.db
        .select({ id: tenantsTable.id })
        .from(tenantsTable);
      for (const t of tenantRows) {
        for (const mod of modules) {
          if (mod.defaultInstall === false) continue;
          await writeInstallRow(mod, t.id);
        }
      }
    },

    async install(moduleId, tenantId) {
      const mod = getModule(moduleId);
      if (!mod) {
        return { ok: false, hookError: `Unknown module ${moduleId}` };
      }
      let hookError: string | undefined;
      // Migrations first so onInstall can rely on tables
      // existing.
      try {
        await applyMigrations(mod, tenantId);
      } catch (e) {
        hookError = `migration error: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (!hookError) {
        try {
          await mod.lifecycle?.onInstall?.(ctxFor(mod, tenantId));
        } catch (e) {
          hookError = e instanceof Error ? e.message : String(e);
        }
      }
      // MDK T7.1 — declarative auto-seed. Runs after `onInstall` so
      // hooks can wire preconditions (e.g. fetch the Claude runtime
      // id). Idempotent on (tenantId, source = `module:<id>`, name).
      if (!hookError) {
        try {
          await runSeed(deps.db, mod, tenantId, {
            agents: mod.agents,
            workflows: mod.workflows,
            routines: mod.routines,
          });
        } catch (e) {
          hookError = `auto-seed error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      await writeInstallRow(mod, tenantId);
      // Notify subscribers (shell SSE → invalidate install cache).
      deps.realtimeBus?.publish({
        type: "module:installed",
        tenantId,
        data: { moduleId, version: mod.version, hookError: hookError ?? null },
        timestamp: new Date().toISOString(),
      });
      return { ok: !hookError, hookError };
    },

    async uninstall(moduleId, tenantId) {
      const mod = getModule(moduleId);
      if (!mod) {
        return { ok: false, hookError: `Unknown module ${moduleId}` };
      }
      let hookError: string | undefined;
      // onUninstall first so the module can read its tables one
      // last time before they're dropped.
      try {
        await mod.lifecycle?.onUninstall?.(ctxFor(mod, tenantId));
      } catch (e) {
        hookError = e instanceof Error ? e.message : String(e);
      }
      // Roll back schema regardless of hook failure — leftover
      // tables are worse than a missing hook side-effect.
      await rollbackMigrations(mod, tenantId);
      await deps.db
        .delete(moduleInstalls)
        .where(
          and(
            eq(moduleInstalls.tenantId, tenantId),
            eq(moduleInstalls.moduleId, moduleId),
          ),
        );
      deps.realtimeBus?.publish({
        type: "module:uninstalled",
        tenantId,
        data: { moduleId, hookError: hookError ?? null },
        timestamp: new Date().toISOString(),
      });
      return { ok: !hookError, hookError };
    },

    async onTenantCreated(tenantId) {
      for (const mod of deps.modules) {
        if (mod.defaultInstall === false) continue;
        try {
          await applyMigrations(mod, tenantId);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(
            `[install-manager] migration failed for ${mod.id} on new tenant ${tenantId}:`,
            e,
          );
        }
        try {
          await mod.lifecycle?.onTenantCreate?.(ctxFor(mod, tenantId));
        } catch (e) {
          // Log to stderr; one bad module shouldn't block the
          // others. The install row is still written so the
          // tenant has the module catalog available; ops can
          // re-run the hook manually if needed.
          // eslint-disable-next-line no-console
          console.error(
            `[install-manager] onTenantCreate failed for ${mod.id}:`,
            e,
          );
        }
        // MDK T7.1 — declarative auto-seed for new tenants too.
        try {
          await runSeed(deps.db, mod, tenantId, {
            agents: mod.agents,
            workflows: mod.workflows,
            routines: mod.routines,
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(
            `[install-manager] auto-seed failed for ${mod.id} on new tenant ${tenantId}:`,
            e,
          );
        }
        await writeInstallRow(mod, tenantId);
      }
    },

    async isInstalled(moduleId, tenantId) {
      const rows = await deps.db
        .select({ id: moduleInstalls.id })
        .from(moduleInstalls)
        .where(
          and(
            eq(moduleInstalls.tenantId, tenantId),
            eq(moduleInstalls.moduleId, moduleId),
          ),
        )
        .limit(1);
      if (rows.length > 0) return true;

      // Lazy auto-install for default-install modules: keeps the
      // -parity contract (every tenant sees every module by
      // default) without forcing test setups + new-tenant flows
      // through a separate backfill step. Modules with
      // `defaultInstall: false` require explicit install.
      const mod = getModule(moduleId);
      if (!mod || mod.defaultInstall === false) return false;
      try {
        await writeInstallRow(mod, tenantId);
      } catch (e) {
        // FK violation here usually means the tenant id doesn't
        // exist — tell the caller it's not installed and let the
        // dispatcher handle it as a permission error.
        // eslint-disable-next-line no-console
        console.error(
          `[install-manager] lazy install of ${moduleId} for ${tenantId} failed:`,
          e,
        );
        return false;
      }
      return true;
    },

    async listForTenant(tenantId) {
      const rows = await deps.db
        .select()
        .from(moduleInstalls)
        .where(eq(moduleInstalls.tenantId, tenantId));
      return rows.map((r) => ({
        moduleId: r.moduleId,
        version: r.version,
        installedAt: r.installedAt,
        config: (r.config ?? {}) as Record<string, unknown>,
      }));
    },
  };
}

// ── MDK T7.1: Lifecycle.seed implementation ────────────────────────────────

/**
 * Idempotent seeder for module-declared agents / workflows / routines.
 *
 * Idempotency keys per kind:
 *   - agents:    (tenantId, source = "app", sourceAppId = `<id>`, name)
 *                The check constraint `agents_source_app_id_check`
 *                forces `source = 'app'` whenever `source_app_id` is
 *                set, so module-installed agents live under the
 *                "app"-source bucket with the module id in
 *                `source_app_id`. CRM uses the same convention; T8.3
 *                will promote CRM seeds onto this helper.
 *   - workflows: (tenantId, type = `module:<id>`, name) — workflows
 *                table has no `source_app_id` constraint, so the
 *                `type` column doubles as the source bucket.
 *   - routines:  (tenantId, title) — routines table has no source
 *                column today; T7.2 introduces `__seed_meta` with a
 *                stable seedId, making this dedupe formal. For now,
 *                (tenant, title) is the natural key the framework
 *                already treats as unique per tenant.
 *
 * Skipped rows are counted but not modified — tenant edits survive
 * re-installs (the "always updated" guarantee comes from T7.2's
 * `modified_since_install` flag).
 */
async function runSeed(
  db: Db,
  mod: Module,
  tenantId: string,
  payload: SeedPayload,
): Promise<SeedResult> {
  const sourceAppId = mod.id;
  const workflowBucket = `module:${mod.id}`;
  const result: SeedResult = {
    agentsSeeded: 0,
    workflowsSeeded: 0,
    routinesSeeded: 0,
    agentsSkipped: 0,
    workflowsSkipped: 0,
    routinesSkipped: 0,
  };

  // ── Agents ────────────────────────────────────────────────
  // Resolve the tenant's root agent once — every seeded agent
  // reports up to it by default. The `agents_tenant_one_root_idx`
  // unique index allows only one `reports_to IS NULL` row per tenant,
  // so seeded agents MUST have a parent.
  let rootAgentId: string | null = null;
  if ((payload.agents ?? []).length > 0) {
    const rootRows = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(
        and(
          eq(agentsTable.tenantId, tenantId),
          // drizzle isNull import would add weight; inline raw is fine.
          sql`${agentsTable.reportsTo} IS NULL`,
        ),
      )
      .limit(1);
    rootAgentId = rootRows[0]?.id ?? null;
  }
  const agentSeedIds = new Map<string, string>(); // name → row id, for reportsTo resolution
  for (const seed of payload.agents ?? []) {
    const existing = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(
        and(
          eq(agentsTable.tenantId, tenantId),
          eq(agentsTable.sourceAppId, sourceAppId),
          eq(agentsTable.name, seed.name),
        ),
      )
      .limit(1);
    if (existing[0]) {
      agentSeedIds.set(seed.name, existing[0].id);
      result.agentsSkipped += 1;
      continue;
    }
    // Resolve runtime (best-effort): pick any active runtime for the
    // tenant. Authors needing a specific runtime (e.g. Claude) should
    // use the imperative path (Lifecycle.seed from onInstall) instead.
    const rtRows = await db
      .select({ id: runtimesTable.id })
      .from(runtimesTable)
      .where(eq(runtimesTable.tenantId, tenantId))
      .limit(1);
    const runtimeId = rtRows[0]?.id ?? null;
    const reportsToId =
      seed.reportsTo && agentSeedIds.has(seed.reportsTo)
        ? agentSeedIds.get(seed.reportsTo)!
        : rootAgentId;
    const inserted = await db
      .insert(agentsTable)
      .values({
        tenantId,
        name: seed.name,
        role: seed.persona,
        source: "app",
        sourceAppId,
        runtimeId,
        reportsTo: reportsToId,
        instructions: seed.instructions ?? null,
      })
      .returning({ id: agentsTable.id });
    if (inserted[0]) {
      agentSeedIds.set(seed.name, inserted[0].id);
      result.agentsSeeded += 1;
    }
  }

  // ── Workflows ─────────────────────────────────────────────
  for (const seed of payload.workflows ?? []) {
    const existing = await db
      .select({ id: workflowsTable.id })
      .from(workflowsTable)
      .where(
        and(
          eq(workflowsTable.tenantId, tenantId),
          eq(workflowsTable.type, workflowBucket),
          eq(workflowsTable.name, seed.name),
        ),
      )
      .limit(1);
    if (existing[0]) {
      result.workflowsSkipped += 1;
      continue;
    }
    await db.insert(workflowsTable).values({
      tenantId,
      name: seed.name,
      type: workflowBucket,
      status: "active",
      blocks: seed.blocks as unknown as Record<string, unknown>[],
      edges: seed.edges as unknown as Record<string, unknown>[],
    });
    result.workflowsSeeded += 1;
  }

  // ── Routines ──────────────────────────────────────────────
  for (const seed of payload.routines ?? []) {
    if (seed.trigger.type !== "cron") {
      // Routines table currently only models cron triggers; event /
      // webhook routines are stored elsewhere (the workflow trigger
      // field). Skip non-cron seeds rather than fail — they'll be
      // covered by T7.2 + T7.3.
      continue;
    }
    const existing = await db
      .select({ id: routinesTable.id })
      .from(routinesTable)
      .where(
        and(
          eq(routinesTable.tenantId, tenantId),
          eq(routinesTable.title, seed.title),
        ),
      )
      .limit(1);
    if (existing[0]) {
      result.routinesSkipped += 1;
      continue;
    }
    await db.insert(routinesTable).values({
      tenantId,
      title: seed.title,
      cronExpression: seed.trigger.expression,
      timezone: seed.trigger.timezone ?? "UTC",
      status: seed.enabled === false ? "paused" : "active",
      concurrencyPolicy: seed.concurrency ?? "skip_if_active",
    });
    result.routinesSeeded += 1;
  }

  // ── Custom ────────────────────────────────────────────────
  if (typeof payload.custom === "function") {
    await payload.custom();
  }
  return result;
}
