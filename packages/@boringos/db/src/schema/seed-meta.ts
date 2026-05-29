import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

// MDK T7.2 — per-tenant seed tracking.
//
// One row per (tenant, module, kind, seedId) seeded by the framework
// or a module's `Lifecycle.seed` call. `baseline_hash` captures the
// canonical JSON of the seed payload at install time; on upgrade we
// compare the current row's hash to detect tenant edits.
// `target_id` is the row in `agents` / `workflows` / `routines`.
export const seedMeta = pgTable(
  "__seed_meta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    moduleId: text("module_id").notNull(),
    kind: text("kind").notNull(), // 'agent' | 'workflow' | 'routine' (CHECK in SQL)
    seedId: text("seed_id").notNull(),
    targetId: uuid("target_id").notNull(),
    baselineHash: text("baseline_hash").notNull(),
    moduleVersion: text("module_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("__seed_meta_uniq_idx").on(t.tenantId, t.moduleId, t.kind, t.seedId),
    targetIdx: index("__seed_meta_target_idx").on(t.targetId),
  }),
);
