// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `module_packages` — host-global (LAYER-1) record of every uploaded
// `.hebbsmod` package. One row per (module_id, version) uploaded to
// this host. Distinct from `module_installs`, which is per-tenant
// opt-in state.
//
// task_22: module package upload / install flow. The upload endpoint
// extracts the .hebbsmod, stores it under store_path, and records the
// (id, version, kind, content_hash) here so subsequent installs can
// resolve a module by id+version without re-uploading.

import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const modulePackages = pgTable(
  "module_packages",
  {
    id: text("id").notNull(),
    version: text("version").notNull(),
    kind: text("kind").notNull(),
    storePath: text("store_path").notNull(),
    contentHash: text("content_hash").notNull(),
    signaturePublisherId: text("signature_publisher_id"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.version] }),
    contentHashIdx: index("module_packages_content_hash_idx").on(table.contentHash),
  }),
);
