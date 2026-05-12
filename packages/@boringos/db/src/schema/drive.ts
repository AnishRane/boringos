import { pgTable, uuid, text, integer, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const driveFiles = pgTable(
  "drive_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    path: text("path").notNull(),
    filename: text("filename").notNull(),
    format: text("format"),
    size: integer("size").notNull().default(0),
    hash: text("hash"),
    syncedToMemory: boolean("synced_to_memory").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One row per (tenant, path). Prevents the duplicate-row bug
    // that surfaced when the memory-checkpoint reindex ran after
    // any file was rewritten — the reindex code now uses
    // delete-then-insert, but the constraint is the real defense.
    pathUniq: uniqueIndex("drive_files_tenant_path_uniq").on(
      t.tenantId,
      t.path,
    ),
  }),
);

export const driveSkillRevisions = pgTable("drive_skill_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  content: text("content").notNull(),
  changedBy: text("changed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
