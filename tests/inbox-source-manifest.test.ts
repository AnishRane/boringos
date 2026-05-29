// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T7.3 — `inboxSource` manifest field.
//
// A Module that declares `inboxSource: {...}` at the manifest level
// must result in a row written to `inbox_items` when a matching event
// is published — the same behaviour as the static-host
// `app.routeToInbox()` API, but available to runtime `.hebbsmod`
// modules too.
//
// We boot a host with one fixture module that declares an
// `inboxSource` and publish a matching event through the event bus.

import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BoringOS,
  createFrameworkModule,
  createMemoryModule,
  createDriveModule,
  createInboxModule,
  createWorkflowModule,
  createCopilotModule,
} from "@boringos/core";
import type { Module, ModuleFactory } from "@boringos/module-sdk";
import { inboxItems } from "@boringos/db";
import { eq } from "drizzle-orm";

function createInboxFixture(): ModuleFactory {
  return () =>
    ({
      id: "inbox-fixture",
      name: "Inbox Fixture",
      version: "0.1.0",
      description: "MDK T7.3 — declarative inbox source",
      defaultInstall: false,
      tools: [],
      inboxSource: {
        eventType: "fixture.message_received",
        filter: { path: "$.data.label", equals: "important" },
        map: {
          source: "fixture",
          subject: "$.data.subject",
          body: "$.data.body",
          from: "$.data.from",
        },
      },
    }) satisfies Module;
}

describe("MDK T7.3 — declarative inboxSource", () => {
  it("manifest inboxSource writes matching events to inbox_items", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "t7-3-pg-"));
    const app = new BoringOS({
      database: {
        embedded: true,
        port: 5400 + Math.floor(Math.random() * 200),
        dataDir: join(dataDir, "pg"),
      },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: "t7-3-test" },
      queue: { concurrency: 1 },
    });
    app.module(createFrameworkModule);
    app.module(createMemoryModule);
    app.module(createDriveModule);
    app.module(createInboxModule);
    app.module(createWorkflowModule);
    app.module(createCopilotModule);
    app.module(createInboxFixture());

    const server = await app.listen(0);
    const db = (
      server as unknown as { context: { db: import("@boringos/db").Db } }
    ).context.db;
    try {
      // Sign up a tenant so we have a non-null tenantId for the event.
      const signupRes = await fetch(`${server.url}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "T7.3",
          email: `t7-3-${Date.now()}@example.com`,
          password: "pw",
          tenantName: "T7.3 Org",
        }),
      });
      expect(signupRes.status).toBe(201);
      const { tenants } = await import("@boringos/db");
      const tenantRows = await db.select().from(tenants);
      const tenantId = tenantRows[0].id;

      // Publish a non-matching event first (wrong label) — no row.
      const eventBus = (
        server as unknown as {
          context: { eventBus: { emit: (e: unknown) => Promise<void> } };
        }
      ).context.eventBus;
      await eventBus.emit({
        type: "fixture.message_received",
        tenantId,
        timestamp: new Date().toISOString(),
        data: {
          label: "spam",
          subject: "Junk",
          body: "ignore me",
          from: "junk@x.test",
        },
      });

      // Now a matching event.
      await eventBus.emit({
        type: "fixture.message_received",
        tenantId,
        timestamp: new Date().toISOString(),
        data: {
          label: "important",
          subject: "Hi from Grace",
          body: "Quick question.",
          from: "grace@x.test",
        },
      });

      // Inbox writes happen inside an onAny callback — give it a tick.
      await new Promise((res) => setTimeout(res, 100));

      const items = await db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.tenantId, tenantId));
      expect(items.length).toBe(1);
      expect(items[0].source).toBe("fixture");
      expect(items[0].subject).toBe("Hi from Grace");
      expect(items[0].body).toBe("Quick question.");
      expect(items[0].from).toBe("grace@x.test");
    } finally {
      await server.close();
    }
  }, 120_000);
});
