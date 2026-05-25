import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Db } from "@boringos/db";
import type { RealtimeBus } from "./realtime.js";

export function createSSERoutes(bus: RealtimeBus, adminKey: string, db?: Db): Hono {
  const app = new Hono();

  // GET /events — SSE stream. Authenticated via API key (machine) OR a
  // session token (browser shells — EventSource can't set headers, so the
  // token rides as `?token=`, validated like the admin API).
  app.get("/events", async (c) => {
    const apiKey = c.req.header("X-API-Key") ?? c.req.query("apiKey");
    const token = c.req.query("token") ?? c.req.header("Authorization")?.replace("Bearer ", "");

    let tenantId = c.req.header("X-Tenant-Id") ?? c.req.query("tenantId") ?? "";
    let authed = false;

    if (apiKey && apiKey === adminKey) {
      authed = true;
    } else if (token && db) {
      const { validateSession } = await import("./auth.js");
      const session = await validateSession(db, token);
      if (session) {
        authed = true;
        if (!tenantId) tenantId = session.tenantId;
      }
    }

    if (!authed) return c.json({ error: "Invalid or missing authentication" }, 401);
    if (!tenantId) return c.json({ error: "Missing tenant ID" }, 400);

    return streamSSE(c, async (stream) => {
      const unsubscribe = bus.subscribe(tenantId, (event) => {
        // Unnamed (default "message") events so EventSource.onmessage fires;
        // the full event — including its `type` — is in the JSON payload.
        stream.writeSSE({ data: JSON.stringify(event) });
      });

      // Keep connection alive with a named heartbeat (ignored by onmessage).
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" });
      }, 30000);

      stream.onAbort(() => {
        unsubscribe();
        clearInterval(heartbeat);
      });

      // Hold the connection open
      await new Promise(() => {});
    });
  });

  return app;
}
