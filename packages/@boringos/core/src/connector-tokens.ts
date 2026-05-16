// SPDX-License-Identifier: MIT
//
// Connector token dispatcher + audit log.
//
// Each provider keeps its own token-loading + refresh logic in its
// module file (e.g. `modules/google.ts` exports `getGoogleToken`).
// This file routes a kind string to the right provider function and
// is what `BoringOS` injects into `ModuleFactoryDeps.getConnectorToken`.
//
// Adding a new provider:
//   1. Implement `getXyzToken(db, tenantId)` in `modules/xyz.ts`.
//   2. Add a `xyz: getXyzToken` entry to the `providers` map below.
//
// Returning `null` is the universal "not connected / unknown kind"
// signal — module authors check for null and fail-soft.
//
// Every call writes one row to `connector_token_issuance` for audit.
// The audit write is fire-and-forget — a logging failure must never
// block a token issuance. Access tokens are never persisted here.

import type { Db } from "@boringos/db";
import { connectorTokenIssuance } from "@boringos/db";
import { getGoogleToken } from "./modules/google.js";
import { getSlackToken } from "./modules/slack.js";

type TokenProvider = (
  db: Db,
  tenantId: string,
) => Promise<{ accessToken: string } | null>;

const providers: Record<string, TokenProvider> = {
  google: getGoogleToken,
  slack: getSlackToken,
};

type Outcome = "issued" | "not_connected";

function recordIssuance(
  db: Db,
  tenantId: string,
  kind: string,
  callerModuleId: string,
  outcome: Outcome,
): void {
  // Fire-and-forget — never blocks the caller, never throws.
  db.insert(connectorTokenIssuance)
    .values({
      tenantId,
      kind,
      callerModuleId: callerModuleId || "unknown",
      outcome,
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[connector-tokens] audit write failed for kind=${kind}, caller=${callerModuleId}:`,
        err instanceof Error ? err.message : err,
      );
    });
}

export async function getConnectorTokenForTenant(
  db: Db,
  kind: string,
  tenantId: string,
  callerModuleId = "unknown",
): Promise<{ accessToken: string } | null> {
  const provider = providers[kind];
  if (!provider) {
    recordIssuance(db, tenantId, kind, callerModuleId, "not_connected");
    return null;
  }
  const result = await provider(db, tenantId);
  recordIssuance(
    db,
    tenantId,
    kind,
    callerModuleId,
    result ? "issued" : "not_connected",
  );
  return result;
}
