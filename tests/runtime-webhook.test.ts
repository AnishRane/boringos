/**
 * task_22 U3.2 — runtime module webhook dispatch.
 *
 * Verifies that the boot-time webhook dispatcher (mounted at
 * `/api/webhooks/:moduleId/:event` in boringos.ts) correctly:
 *
 *   1. Routes a POST to a module registered AFTER `listen()`
 *      resolves. This is the path the `.hebbsmod` upload route
 *      will use — webhooks declared by a freshly-uploaded module
 *      must be reachable without a host restart.
 *   2. Returns 404 once that module is unregistered. This is the
 *      flip side: deleting a module package must take effect
 *      immediately for inbound webhooks too.
 *
 * The dispatcher reads `boundModules` per-request, so there's no
 * Hono `app.route()` un-mount needed — register/unregister are
 * pure state mutations on a shared array.
 *
 * Hono mid-flight mount audit: a sanity check (run during U3.2's
 * implementation, not committed) confirmed that
 * `app.route(path, sub)` after `serve()` DOES route subsequent
 * requests correctly — Hono builds its trie lazily. We still went
 * with the boot-time dispatcher because Hono has no symmetric
 * un-mount API; relying on `app.route()` per `registerModule()`
 * would mean `unregisterModule()` couldn't reliably remove the
 * route, leading to zombie handlers + permission_denied surprises
 * after a delete.
 */
import { describe, it, expect } from "vitest";

describe("task_22 — module webhook dispatch (runtime register + unregister)", () => {
  it(
    "routes POST /api/webhooks/<id>/<event> to a runtime-registered module and 404s after unregister",
    async () => {
      const { BoringOS, createFrameworkModule, createMemoryModule } = await import(
        "@boringos/core"
      );
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const dataDir = await mkdtemp(join(tmpdir(), "boringos-u3-webhook-"));
      const app = new BoringOS({
        // Distinct PG port to avoid colliding with other phase tests
        // (5588 = runtime-register, 5589 = builtin-modules, etc.).
        database: { embedded: true, dataDir, port: 5594 },
        drive: { root: join(dataDir, "drive") },
        auth: { secret: "u3-webhook-secret" },
        queue: { concurrency: 1 },
      });

      // Boot with framework + memory only. The webhook-probe module
      // is registered post-listen, mirroring the `.hebbsmod` upload
      // path's runtime registration.
      app.module(createFrameworkModule);
      app.module(createMemoryModule);

      const server = await app.listen(0);
      try {
        // Synthetic webhook-only module. Verify always returns true
        // so the handler always runs. The handler is the extended
        // shape (returns {status, body}) — the dispatcher unwraps it.
        const probeModule = {
          id: "webhook-probe",
          name: "Webhook Probe",
          version: "0.0.1",
          description: "Synthetic webhook module for cascade tests",
          // No tools / skills; just one webhook.
          tools: [],
          skills: [],
          webhooks: [
            {
              event: "ping",
              description: "Echoes the JSON body back.",
              verify: async () => true,
              handler: async (req: { body: string }) => {
                const received = JSON.parse(req.body);
                return { status: 200, body: { ok: true, received } };
              },
            },
          ],
          // Skip the install-manager backfill — this is a host-only
          // capability module with no schema or per-tenant state.
          defaultInstall: false,
        } as Parameters<typeof app.registerModule>[0];

        const deps = app.factoryDeps;
        expect(deps).not.toBeNull();

        // ── Register webhook-probe at runtime ───────────────────
        const regResult = await app.registerModule(probeModule, deps!);
        expect(regResult.moduleId).toBe("webhook-probe");

        // ── Dispatch the webhook ────────────────────────────────
        const hit = await fetch(
          `${server.url}/api/webhooks/webhook-probe/ping`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hello: "world" }),
          },
        );
        expect(hit.status).toBe(200);
        const hitBody = (await hit.json()) as {
          ok: boolean;
          received: { hello: string };
        };
        expect(hitBody.ok).toBe(true);
        expect(hitBody.received.hello).toBe("world");

        // ── Unregister, then re-hit ─────────────────────────────
        const unregResult = await app.unregisterModule("webhook-probe");
        expect(unregResult.moduleId).toBe("webhook-probe");
        expect(unregResult.restartRecommended).toBe(true);

        const missed = await fetch(
          `${server.url}/api/webhooks/webhook-probe/ping`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hello: "world" }),
          },
        );
        // The dispatcher now misses on `boundModules.find(...)`,
        // so the response is the dispatcher's own 404 envelope.
        expect(missed.status).toBe(404);
        const missedBody = (await missed.json()) as { error: string };
        expect(missedBody.error).toBe("module_not_found");

        // ── Unknown event on a registered module → 404 too ──────
        await app.registerModule(probeModule, deps!);
        const unknownEvent = await fetch(
          `${server.url}/api/webhooks/webhook-probe/not-a-real-event`,
          { method: "POST", body: "{}" },
        );
        expect(unknownEvent.status).toBe(404);
        const unknownBody = (await unknownEvent.json()) as { error: string };
        expect(unknownBody.error).toBe("webhook_not_found");

        // ── Re-register → re-dispatch works (no leaked state) ───
        const reHit = await fetch(
          `${server.url}/api/webhooks/webhook-probe/ping`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ second: "round" }),
          },
        );
        expect(reHit.status).toBe(200);
        const reHitBody = (await reHit.json()) as {
          received: { second: string };
        };
        expect(reHitBody.received.second).toBe("round");

        // Clean up so a subsequent test in the same file (or a re-run
        // of this file in the same pnpm session) doesn't see leaked
        // registrations.
        await app.unregisterModule("webhook-probe");
      } finally {
        await server.close();
      }
    },
    120_000,
  );
});
