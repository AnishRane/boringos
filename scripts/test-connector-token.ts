/**
 * Manual validation script for getConnectorTokenForTenant.
 *
 * Boots BoringOS with embedded Postgres, inserts a fake Google connector
 * row, and exercises all paths through the dispatcher:
 *   1. No connector row → null + 'not_connected' audit row
 *   2. Fresh token → returned as-is + 'issued' audit row
 *   3. Expiring token + refreshToken → refresh attempted (fails without
 *      real Google creds; falls back to existing) + 'issued' audit row
 *   4. Verify the connector_token_issuance table contains the rows
 *      we expect, tagged with caller_module_id='manual-test'
 *
 * Run: npx tsx scripts/test-connector-token.ts
 */
import { BoringOS, createGoogleModule, getConnectorTokenForTenant } from "@boringos/core";
import { tenants, connectors, connectorTokenIssuance } from "@boringos/db";
import { generateId } from "@boringos/shared";
import { eq, asc } from "drizzle-orm";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dataDir = join(tmpdir(), `boring-token-test-${Date.now()}`);
mkdirSync(dataDir, { recursive: true });

async function main() {
  console.log("Booting BoringOS with embedded Postgres...\n");

  const app = new BoringOS({
    database: { embedded: true, dataDir, port: 15502 },
  });
  app.module(createGoogleModule);

  const server = await app.listen(15503);
  const db = (server.context as { db: import("@boringos/db").Db }).db;

  // Create a tenant
  const tenantId = generateId();
  await db.insert(tenants).values({ id: tenantId, name: "Test Corp", slug: "test-corp" });
  console.log(`Tenant created: ${tenantId}`);

  const CALLER = "manual-test";

  // ── Test 1: No connector row → should return null ──────────────────────────
  console.log("\n[1/4] No connector row → expect null");
  const result1 = await getConnectorTokenForTenant(db, "google", tenantId, CALLER);
  console.log("  Result:", result1);
  console.assert(result1 === null, "FAIL: expected null");
  console.log("  PASS");

  // ── Test 2: Fresh token (not expiring) → return as-is ─────────────────────
  const connectorId = generateId();
  const freshExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min ahead
  await db.insert(connectors).values({
    id: connectorId,
    tenantId,
    kind: "google",
    status: "connected",
    credentials: {
      accessToken: "ya29.fresh-token",
      refreshToken: "1//refresh-tok",
      expiresAt: freshExpiry,
    },
    config: {},
  });

  console.log("\n[2/4] Fresh token (expiresAt=+10min) → expect existing token returned");
  const result2 = await getConnectorTokenForTenant(db, "google", tenantId, CALLER);
  console.log("  Result:", result2);
  console.assert(result2?.accessToken === "ya29.fresh-token", "FAIL: expected fresh token");
  console.log("  PASS");

  // ── Test 3: Expiring token → refresh attempted ─────────────────────────────
  const soonExpiry = new Date(Date.now() + 30 * 1000).toISOString(); // 30 s ahead
  await db
    .update(connectors)
    .set({
      credentials: {
        accessToken: "ya29.expiring-token",
        refreshToken: "1//refresh-tok",
        expiresAt: soonExpiry,
      },
    })
    .where(eq(connectors.id, connectorId));

  console.log("\n[3/4] Expiring token (expiresAt=+30s) → refresh attempted");
  console.log("  (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set, so refresh will fail)");
  console.log("  Expect: falls back to existing token ya29.expiring-token");
  const result3 = await getConnectorTokenForTenant(db, "google", tenantId, CALLER);
  console.log("  Result:", result3);
  // refresh will fail without real creds → function returns existing token
  console.assert(
    result3?.accessToken === "ya29.expiring-token",
    `FAIL: expected expiring token, got ${result3?.accessToken}`,
  );
  console.log("  PASS (refresh failed gracefully, returned existing token)");

  // ── Test 4: Audit rows landed in connector_token_issuance ──────────────────
  // Fire-and-forget writes need a tick to drain.
  await new Promise((r) => setTimeout(r, 200));

  console.log("\n[4/4] Audit rows in connector_token_issuance");
  const auditRows = await db
    .select()
    .from(connectorTokenIssuance)
    .where(eq(connectorTokenIssuance.tenantId, tenantId))
    .orderBy(asc(connectorTokenIssuance.issuedAt));
  console.log(`  ${auditRows.length} row(s) for tenant ${tenantId}:`);
  for (const r of auditRows) {
    console.log(`    kind=${r.kind}  caller=${r.callerModuleId}  outcome=${r.outcome}  at=${r.issuedAt.toISOString()}`);
  }
  console.assert(auditRows.length === 3, `FAIL: expected 3 audit rows, got ${auditRows.length}`);
  console.assert(
    auditRows.every((r) => r.callerModuleId === CALLER),
    `FAIL: every audit row should have caller_module_id="${CALLER}"`,
  );
  console.assert(
    auditRows[0]?.outcome === "not_connected",
    `FAIL: first call should audit as 'not_connected' (no creds yet)`,
  );
  console.assert(
    auditRows[1]?.outcome === "issued" && auditRows[2]?.outcome === "issued",
    `FAIL: calls 2 and 3 should audit as 'issued'`,
  );
  console.log("  PASS (3 rows, all tagged manual-test, outcomes match)");

  console.log("\n✓ All checks passed. Shutting down.\n");
  await server.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error("\nScript failed:", err);
  process.exit(1);
});
