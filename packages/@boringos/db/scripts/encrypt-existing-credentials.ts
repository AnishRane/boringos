// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One-shot migration: encrypt any connectors rows that still hold plaintext
// credentials from before the Task 0.2 deployment.
//
// Run once per environment after deploying the encryption change:
//
//   BORINGOS_ENCRYPTION_KEY=<hex> DATABASE_URL=<url> \
//     pnpm --filter @boringos/db tsx scripts/encrypt-existing-credentials.ts
//
// The script is idempotent:
//   - Rows already encrypted (string value in `credentials`) are skipped.
//   - Rows with NULL credentials are skipped.
//   - Plaintext objects are encrypted and written back.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { connectors } from "../src/schema/connectors.js";
import { packCredentials } from "../src/credentials.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");

  const client = postgres(databaseUrl, { onnotice: () => {} });
  const db = drizzle(client);

  const rows = await db.select().from(connectors);
  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    if (typeof row.credentials === "string") {
      // Already encrypted — skip.
      skipped++;
      continue;
    }
    if (!row.credentials) {
      // NULL — nothing to encrypt.
      skipped++;
      continue;
    }
    // Plain object: encrypt and write back.
    // The `as never` cast is intentional — Drizzle types `credentials` as
    // JSONB (object). The encrypted string goes through the same column.
    // Task 2.1 will re-type this column properly; for now the cast is
    // documented and load-bearing.
    const sealed = packCredentials(row.credentials as Record<string, unknown>);
    await db
      .update(connectors)
      .set({ credentials: sealed as never })
      .where(eq(connectors.id, row.id));
    encrypted++;
  }

  console.log(`Encrypted ${encrypted} rows. Skipped ${skipped}.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
