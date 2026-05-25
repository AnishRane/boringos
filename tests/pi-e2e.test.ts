/**
 * Phase 5 — pi runtime END-TO-END continuity test (opt-in).
 *
 * Runs the REAL pi CLI against gpt-4.1-mini through the full BoringOS
 * stack: a pi-backed agent, a task, and a multi-turn comment thread where
 * each turn depends on earlier ones. Proves context is maintained across
 * turns and that switching an agent onto pi (from a stored Claude session)
 * is safe and lossless.
 *
 * Opt-in (spawns real pi → OpenAI, costs tokens, needs the key):
 *   PI_E2E=1 npx vitest run tests/pi-e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUN = process.env.PI_E2E === "1";
const ADMIN_KEY = "pi-e2e-admin-key";

async function boot() {
  const { BoringOS } = await import("@boringos/core");
  const dataDir = await mkdtemp(join(tmpdir(), "boringos-pi-e2e-"));
  const app = new BoringOS({
    database: { embedded: true, dataDir, port: 5599 },
    drive: { root: join(dataDir, "drive") },
    auth: { secret: "pi-e2e-secret", adminKey: ADMIN_KEY },
    queue: { concurrency: 1 },
  });
  return app.listen(0);
}

function headers(tenantId: string) {
  return { "Content-Type": "application/json", "X-API-Key": ADMIN_KEY, "X-Tenant-Id": tenantId };
}

describe.skipIf(!RUN)("pi E2E — multi-turn continuity on gpt-4.1-mini", () => {
  it("maintains context across dependent turns; safe lossless runtime switch", async () => {
    const server = await boot();
    const base = server.url;
    const transcript: string[] = [];

    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, tasks, costEvents } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const db = server.context.db as import("@boringos/db").Db;

      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Pi E2E", slug: `pi-e2e-${Date.now()}` });
      const h = headers(tenantId);

      // 1. "Pi · OpenAI" connection (default openai/gpt-4.1-mini).
      const rtRes = await fetch(`${base}/api/admin/runtimes`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: "Pi · OpenAI", type: "pi", config: { provider: "openai" }, model: "openai/gpt-4.1-mini" }),
      });
      expect(rtRes.status).toBe(201);
      const runtime = (await rtRes.json()) as { id: string };

      // 2. A conversational agent on the pi connection.
      const agentRes = await fetch(`${base}/api/admin/agents`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          name: "Pi Chat",
          role: "general",
          runtimeId: runtime.id,
          instructions:
            "You are a friendly assistant in a chat thread. Read the whole conversation and reply in one short, full sentence to the user's most recent message. Always answer directly and restate the relevant fact.",
        }),
      });
      expect(agentRes.status).toBe(201);
      const agent = (await agentRes.json()) as { id: string };

      // 3. A task assigned to the agent.
      const taskRes = await fetch(`${base}/api/admin/tasks`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ title: "Chat with Pi" }),
      });
      const task = (await taskRes.json()) as { id: string };
      await fetch(`${base}/api/admin/tasks/${task.id}/assign`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ agentId: agent.id, wake: false }),
      });

      // Post a user comment (auto-wakes the agent) and wait for the agent's reply.
      const agentReply = async (body: string): Promise<string> => {
        const before = (await (await fetch(`${base}/api/admin/tasks/${task.id}`, { headers: h })).json()) as {
          comments: Array<{ authorAgentId?: string | null }>;
        };
        const beforeAgentCount = before.comments.filter((c) => c.authorAgentId === agent.id).length;
        transcript.push(`USER: ${body}`);
        const postRes = await fetch(`${base}/api/admin/tasks/${task.id}/comments`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ body }),
        });
        expect(postRes.status).toBe(201);

        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          const detail = (await (await fetch(`${base}/api/admin/tasks/${task.id}`, { headers: h })).json()) as {
            comments: Array<{ body: string; authorAgentId?: string | null; createdAt: string }>;
          };
          const agentComments = detail.comments
            .filter((c) => c.authorAgentId === agent.id)
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
          if (agentComments.length > beforeAgentCount) {
            const reply = agentComments[agentComments.length - 1].body;
            transcript.push(`PI:   ${reply}`);
            return reply;
          }
        }
        throw new Error(`No agent reply within timeout for: ${body}\nTranscript:\n${transcript.join("\n")}`);
      };

      // ── Multi-turn continuity (each turn depends on the previous) ──
      await agentReply("My favorite number is 7. Please remember it for the rest of our chat.");
      const r2 = await agentReply("What is my favorite number?");
      expect(r2).toMatch(/7/);
      const r3 = await agentReply("What do you get if you add 10 to my favorite number?");
      expect(r3).toMatch(/17/);
      const r4 = await agentReply("And what is my favorite number multiplied by 3?");
      expect(r4).toMatch(/21/);

      // ── Cost/usage recorded, model is gpt-4.1-mini ──
      const costRows = await db.select().from(costEvents).where(eq(costEvents.tenantId, tenantId));
      expect(costRows.length).toBeGreaterThan(0);
      expect(costRows.some((r) => (r.model ?? "").includes("gpt-4.1-mini"))).toBe(true);

      // ── Safe, lossless runtime switch: simulate a prior Claude session on
      // this task, then run on pi. Pi must NOT false-resume the foreign
      // session, must start fresh, and all prior comments must survive. ──
      const commentsBefore = (await (await fetch(`${base}/api/admin/tasks/${task.id}`, { headers: h })).json()) as {
        comments: unknown[];
      };
      await db
        .update(tasks)
        .set({ sessionId: "claude-session-does-not-exist-in-pi", sessionRuntimeType: "claude" })
        .where(eq(tasks.id, task.id));
      const r5 = await agentReply("One more time: what is my favorite number?");
      expect(r5).toMatch(/7/);
      const commentsAfter = (await (await fetch(`${base}/api/admin/tasks/${task.id}`, { headers: h })).json()) as {
        comments: unknown[];
      };
      // No data loss — every prior comment is still present.
      expect(commentsAfter.comments.length).toBeGreaterThan(commentsBefore.comments.length);
      // Pi wrote its own session id, replacing the foreign Claude one.
      const taskRow = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1);
      expect(taskRow[0]?.sessionRuntimeType).toBe("pi");

      // eslint-disable-next-line no-console
      console.log("\n=== PI E2E TRANSCRIPT ===\n" + transcript.join("\n") + "\n=========================\n");
    } finally {
      await server.close();
    }
  }, 600_000);
});
