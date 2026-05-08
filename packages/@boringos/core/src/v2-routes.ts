// SPDX-License-Identifier: MIT
//
// v2 routes — the single agent-callable HTTP surface.
//
// One endpoint: `POST /api/tools/:fullName`. The full name is the
// dotted form `<module-id>.<tool-name>` (e.g. "framework.tasks.patch",
// "google.send_email"). Auth is the same JWT used by v1's
// `/api/agent/*` so existing agent runtimes can call v2 tools with
// no client changes.
//
// Mounted by `boringos.ts` only when at least one v2 module is
// registered. If the host hasn't registered any modules, this
// route tree is not added — keeps v1-only deployments identical.

import { Hono } from "hono";
import type { Db } from "@boringos/db";
import {
  verifyCallbackToken,
  dispatch,
} from "@boringos/agent";
import type {
  CallbackTokenClaims,
  ToolRegistry,
  InstallManager,
} from "@boringos/agent";

type AuthEnv = {
  Variables: { claims: CallbackTokenClaims };
};

export interface V2RoutesDeps {
  db: Db;
  registry: ToolRegistry;
  jwtSecret: string;
  /** Optional. When provided, the dispatcher gates calls on the
   * tool's owning module being installed for the JWT's tenant. */
  installManager?: InstallManager;
}

export function createV2Routes(deps: V2RoutesDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.use("/*", async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        { ok: false, error: { code: "permission_denied", message: "Missing Authorization header", retryable: false } },
        401,
      );
    }
    const token = authHeader.slice(7);
    const claims = verifyCallbackToken(token, deps.jwtSecret);
    if (!claims) {
      return c.json(
        { ok: false, error: { code: "permission_denied", message: "Invalid or expired token", retryable: false } },
        401,
      );
    }
    c.set("claims", claims);
    await next();
  });

  app.post("/:fullName", async (c) => {
    const claims = c.get("claims");
    const fullName = c.req.param("fullName");
    let body: unknown = {};
    try {
      const text = await c.req.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return c.json(
        { ok: false, error: { code: "invalid_input", message: "Body must be valid JSON.", retryable: false } },
        400,
      );
    }

    // Per-tenant install gate — only meaningful for tools that
    // actually exist. Unknown tools fall through to the
    // dispatcher's 404 path so callers get the right error.
    if (deps.installManager && deps.registry.get(fullName)) {
      const moduleId = fullName.includes(".")
        ? fullName.slice(0, fullName.indexOf("."))
        : "";
      if (moduleId) {
        const installed = await deps.installManager.isInstalled(
          moduleId,
          claims.tenant_id,
        );
        if (!installed) {
          return c.json(
            {
              ok: false,
              error: {
                code: "permission_denied",
                message:
                  `Module "${moduleId}" is not installed for this tenant. ` +
                  "An admin can install it via POST /api/admin/v2/modules/<id>/install.",
                retryable: false,
              },
            },
            403,
          );
        }
      }
    }

    const idempotencyKey = c.req.header("Idempotency-Key") ?? undefined;

    const dispatched = await dispatch(
      { registry: deps.registry, db: deps.db },
      fullName,
      body,
      {
        tenantId: claims.tenant_id,
        agentId: claims.agent_id,
        runId: claims.sub,
        invokedBy: "agent",
      },
      { idempotencyKey },
    );

    return c.json(dispatched.result, dispatched.status as 200 | 400 | 403 | 404 | 500);
  });

  return app;
}
