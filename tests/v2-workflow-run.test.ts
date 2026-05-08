/**
 * v2 workflow.run end-to-end — Phase 7 of task_12.
 *
 * Boots BoringOS with framework + workflow modules, seeds a
 * workflow whose DAG is:
 *
 *   trigger → framework.tasks.create → framework.comments.post
 *
 * The second block references the first via {{create.id}} to
 * exercise template substitution. Asserts:
 *  - workflow.run completes successfully
 *  - per-block outputs are returned
 *  - the task + comment were actually created in the DB
 *  - a workflow_runs row records status=completed
 *  - tool_calls audit shows the dispatched calls (with
 *    invokedBy="workflow")
 */
import { describe, it, expect } from "vitest";

describe("v2 — workflow.run", () => {
  it("walks a DAG, dispatches per-block tools, persists run state", async () => {
    const { BoringOS, createFrameworkModule, createWorkflowModule } = await import("@boringos/core");
    const { signCallbackToken } = await import("@boringos/agent");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-v2-wf-"));
    const jwtSecret = "v2-wf-secret";

    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5582 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: jwtSecret },
    });

    app.module(createFrameworkModule);
    app.module(createWorkflowModule);

    const server = await app.listen(0);
    try {
      const { tenants, agents, workflows, workflowRuns, tasks, taskComments, toolCalls } =
        await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const { generateId } = await import("@boringos/shared");
      const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
      const tenantId = "19191919-1919-4191-8191-191919191919";
      const agentId = "1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a";
      const runId = "1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b";

      await db
        .insert(tenants)
        .values({ id: tenantId, name: "Test", slug: "test-wf" })
        .onConflictDoNothing();
      await db
        .insert(agents)
        .values({ id: agentId, tenantId, name: "T", role: "general" })
        .onConflictDoNothing();

      // Seed a workflow: trigger → tasks.create → comments.post
      const workflowId = generateId();
      const triggerBlockId = "t1";
      const createBlockId = "c1";
      const commentBlockId = "m1";
      await db.insert(workflows).values({
        id: workflowId,
        tenantId,
        name: "test workflow",
        blocks: [
          { id: triggerBlockId, kind: "trigger" },
          {
            id: createBlockId,
            kind: "tool",
            tool: "framework.tasks.create",
            inputs: { title: "from workflow" },
          },
          {
            id: commentBlockId,
            kind: "tool",
            tool: "framework.comments.post",
            inputs: {
              taskId: `{{${createBlockId}.id}}`,
              body: "first comment from workflow",
            },
          },
        ] as unknown as Record<string, unknown>[],
        edges: [
          { sourceBlockId: triggerBlockId, targetBlockId: createBlockId },
          { sourceBlockId: createBlockId, targetBlockId: commentBlockId },
        ] as unknown as Record<string, unknown>[],
      });

      const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);
      const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      // Run the workflow.
      const res = await fetch(`${server.url}/api/tools/workflow.run`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ workflowId }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        result: {
          runId: string;
          outputs: Record<string, { id?: string }>;
          visited: string[];
        };
      };
      expect(body.ok).toBe(true);
      expect(body.result.visited).toEqual([triggerBlockId, createBlockId, commentBlockId]);

      // The first tool block produced a task id; the second
      // block's templated input resolved to that id.
      const createdTaskId = body.result.outputs[createBlockId]?.id as string | undefined;
      expect(createdTaskId).toBeTruthy();

      // The actual task was created via the framework tool.
      const taskRows = await db.select().from(tasks).where(eq(tasks.id, createdTaskId!));
      expect(taskRows[0]?.title).toBe("from workflow");
      expect(taskRows[0]?.tenantId).toBe(tenantId);

      // The comment landed on it.
      const commentRows = await db
        .select()
        .from(taskComments)
        .where(eq(taskComments.taskId, createdTaskId!));
      expect(commentRows.length).toBeGreaterThanOrEqual(1);
      expect(commentRows.some((c) => c.body === "first comment from workflow")).toBe(true);

      // workflow_runs row reflects status=completed.
      const wfRunRows = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, body.result.runId));
      expect(wfRunRows[0]?.status).toBe("completed");
      expect(typeof wfRunRows[0]?.durationMs).toBe("number");

      // tool_calls audit captured the dispatched calls and tagged
      // them with invokedBy="workflow".
      const audits = await db
        .select()
        .from(toolCalls)
        .where(eq(toolCalls.tenantId, tenantId));
      const fromWorkflow = audits.filter((a) => a.invokedBy === "workflow");
      expect(fromWorkflow.length).toBeGreaterThanOrEqual(2);
      const wfTools = new Set(fromWorkflow.map((a) => a.toolName));
      expect(wfTools.has("framework.tasks.create")).toBe(true);
      expect(wfTools.has("framework.comments.post")).toBe(true);
    } finally {
      await server.close();
    }
  }, 90000);

  it("propagates a failed block as workflow_runs status=failed", async () => {
    const { BoringOS, createFrameworkModule, createWorkflowModule } = await import("@boringos/core");
    const { signCallbackToken } = await import("@boringos/agent");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-v2-wf-fail-"));
    const jwtSecret = "v2-wf-fail-secret";

    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5581 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: jwtSecret },
    });

    app.module(createFrameworkModule);
    app.module(createWorkflowModule);

    const server = await app.listen(0);
    try {
      const { tenants, agents, workflows, workflowRuns } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const { generateId } = await import("@boringos/shared");
      const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
      const tenantId = "1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c";
      const agentId = "1d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d";
      const runId = "1e1e1e1e-1e1e-41e1-81e1-1e1e1e1e1e1e";

      await db
        .insert(tenants)
        .values({ id: tenantId, name: "Test", slug: "test-wf-fail" })
        .onConflictDoNothing();
      await db
        .insert(agents)
        .values({ id: agentId, tenantId, name: "T", role: "general" })
        .onConflictDoNothing();

      // Workflow with a tool block referencing a non-existent
      // tool — the dispatcher returns 404 and the run fails.
      const workflowId = generateId();
      await db.insert(workflows).values({
        id: workflowId,
        tenantId,
        name: "should fail",
        blocks: [
          { id: "t", kind: "trigger" },
          { id: "x", kind: "tool", tool: "framework.does_not_exist", inputs: {} },
        ] as unknown as Record<string, unknown>[],
        edges: [{ sourceBlockId: "t", targetBlockId: "x" }] as unknown as Record<string, unknown>[],
      });

      const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);
      const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      const res = await fetch(`${server.url}/api/tools/workflow.run`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ workflowId }),
      });
      // Tool returned a structured error → 200 with ok=false.
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; error?: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("upstream_unavailable");

      const wfRuns = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, workflowId));
      expect(wfRuns[0]?.status).toBe("failed");
      expect(wfRuns[0]?.error).toContain("not_found");
    } finally {
      await server.close();
    }
  }, 90000);
});
