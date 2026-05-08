// SPDX-License-Identifier: MIT
//
// v2 install manager — owns the per-tenant install lifecycle.
// Phase 5 + Phase 9 of task_12.
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
import { tenants as tenantsTable, moduleInstalls } from "@boringos/db";
import type { Module, ModuleContext, ModuleDb } from "@boringos/module-sdk";

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
}

export function createInstallManager(deps: InstallManagerDeps): InstallManager {
  const moduleById = new Map(deps.modules.map((m) => [m.id, m]));

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

  const ctxFor = (mod: Module, tenantId: string): ModuleContext => ({
    tenantId,
    moduleId: mod.id,
    db: moduleDb,
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
      const mod = moduleById.get(moduleId);
      if (!mod) {
        return { ok: false, hookError: `Unknown module ${moduleId}` };
      }
      let hookError: string | undefined;
      try {
        await mod.lifecycle?.onInstall?.(ctxFor(mod, tenantId));
      } catch (e) {
        hookError = e instanceof Error ? e.message : String(e);
      }
      await writeInstallRow(mod, tenantId);
      return { ok: !hookError, hookError };
    },

    async uninstall(moduleId, tenantId) {
      const mod = moduleById.get(moduleId);
      if (!mod) {
        return { ok: false, hookError: `Unknown module ${moduleId}` };
      }
      let hookError: string | undefined;
      try {
        await mod.lifecycle?.onUninstall?.(ctxFor(mod, tenantId));
      } catch (e) {
        hookError = e instanceof Error ? e.message : String(e);
      }
      await deps.db
        .delete(moduleInstalls)
        .where(
          and(
            eq(moduleInstalls.tenantId, tenantId),
            eq(moduleInstalls.moduleId, moduleId),
          ),
        );
      return { ok: !hookError, hookError };
    },

    async onTenantCreated(tenantId) {
      for (const mod of deps.modules) {
        if (mod.defaultInstall === false) continue;
        try {
          await mod.lifecycle?.onTenantCreate?.(ctxFor(mod, tenantId));
        } catch (e) {
          // Log to stderr; one bad module shouldn't block the
          // others. The install row is still written so the
          // tenant has the module catalog available; ops can
          // re-run the hook manually if needed.
          // eslint-disable-next-line no-console
          console.error(
            `[v2-install-manager] onTenantCreate failed for ${mod.id}:`,
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
      // v1-parity contract (every tenant sees every module by
      // default) without forcing test setups + new-tenant flows
      // through a separate backfill step. Modules with
      // `defaultInstall: false` require explicit install.
      const mod = moduleById.get(moduleId);
      if (!mod || mod.defaultInstall === false) return false;
      try {
        await writeInstallRow(mod, tenantId);
      } catch (e) {
        // FK violation here usually means the tenant id doesn't
        // exist — tell the caller it's not installed and let the
        // dispatcher handle it as a permission error.
        // eslint-disable-next-line no-console
        console.error(
          `[v2-install-manager] lazy install of ${moduleId} for ${tenantId} failed:`,
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
