// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One-shot data migration: copies rows from the legacy connectors table into
// connector_accounts. Idempotent. Safe to re-run.
//
// Prerequisites:
//   1. Deploy the schema migration (connector_accounts table must exist).
//   2. Run encrypt-existing-credentials.ts first so every connectors row has
//      an encrypted string in the credentials column.
//
// Usage:
//   DATABASE_URL=<url> pnpm --filter @boringos/db tsx scripts/migrate-connectors-to-accounts.ts
//
// Idempotency: the unique constraint on (tenant_id, provider, account_id) plus
// onConflictDoNothing() means re-running is safe and will not create duplicates.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { connectors } from "../src/schema/connectors.js";
import { connectorAccounts } from "../src/schema/connector-accounts.js";

// Best-effort scope backfill for known providers.
// These match the ConnectorDefinition.scopes fields in @boringos/connector-google
// and @boringos/connector-slack. Rows migrated here reflect the maximum scope set
// that the platform would have requested at OAuth time.
const KNOWN_SCOPES: Record<string, string[]> = {
  google: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    "openid",
    "email",
    "profile",
  ],
  slack: [
    "chat:write",
    "channels:read",
    "groups:read",
    "reactions:write",
    "reactions:read",
  ],
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");

  const client = postgres(databaseUrl, { onnotice: () => {} });
  const db = drizzle(client);

  const rows = await db.select().from(connectors);
  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.credentials) {
      // NULL credentials -- nothing useful to migrate.
      skipped++;
      continue;
    }

    // After Phase 0 (Task 0.2 / 0.3) credentials must be an encrypted string.
    // If it's still a plain object the operator needs to run
    // encrypt-existing-credentials.ts first.
    if (typeof row.credentials !== "string") {
      console.warn(
        `Skipping row ${row.id} (provider: ${row.kind}): credentials is still a` +
          ` plaintext object. Run encrypt-existing-credentials.ts first.`,
      );
      skipped++;
      continue;
    }

    // Derive a stable accountId from the config JSON stored alongside the token.
    let accountId = "default";
    const config = (row.config ?? {}) as Record<string, unknown>;

    if (row.kind === "google") {
      accountId = (config.email as string | undefined) ?? "default";
    } else if (row.kind === "slack") {
      accountId = (config.team_id as string | undefined) ?? "default";
    }

    await db
      .insert(connectorAccounts)
      .values({
        tenantId: row.tenantId,
        provider: row.kind,
        accountId,
        authStrategy: "oauth2",
        status: row.status ?? "active",
        credentials: row.credentials,
        grantedScopes: KNOWN_SCOPES[row.kind] ?? [],
        profile: config as Record<string, unknown> | null,
      })
      .onConflictDoNothing();

    migrated++;
  }

  console.log(`Migrated ${migrated} rows. Skipped ${skipped}.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
