// SPDX-License-Identifier: MIT
//
// `workflow` Module — exposes workflow operations as tools so
// agents (and other tools) can list, run, and inspect workflows
// from the unified `/api/tools/*` surface.
//
// Phase 5 of task_12. The actual DAG execution stays in the
// existing WorkflowEngine; these tools are thin wrappers.

import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { workflows, workflowRuns } from "@boringos/db";
import { z } from "@boringos/module-sdk";
import { dispatch } from "@boringos/agent";
import type { ToolRegistry } from "@boringos/agent";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";

const WORKFLOW_SKILL = `Workflows are saved DAGs of tool calls. Use these
when you need to:

- Compose tool calls into a reusable pipeline (\`workflow.run\`)
- Look up what's already been built (\`workflow.list\`, \`workflow.get\`)
- Inspect a specific run's per-block outputs (\`workflow.get_run\`)

The visual editor in the shell is the primary author surface; from an agent
you can trigger an existing workflow but you generally shouldn't be
authoring new ones programmatically — that's a human-curation task.`;

/**
 * Walks a DAG and invokes tools per block. Phase 7 of task_12.
 *
 * Supported block kinds in this iteration:
 *  - `trigger` — entry point, output = the trigger payload
 *  - `tool` — invokes the tool by full name through the dispatcher;
 *    inputs may reference upstream node outputs via `{{nodeId.field}}`
 *
 * Deferred to a polish pass:
 *  - condition / for_each / delay / transform / branch
 *
 * Returns: an object mapping each visited block id → its output.
 */
async function runWorkflowDag(
  args: {
    db: Db;
    registry: ToolRegistry;
    workflow: { id: string; blocks: unknown[]; edges: unknown[] };
    triggerPayload: Record<string, unknown>;
    ctx: ToolContext;
  },
): Promise<{ outputs: Record<string, unknown>; visited: string[]; failed?: { blockId: string; error: unknown } }> {
  type Block = {
    id: string;
    kind?: string;
    type?: string;
    tool?: string;
    inputs?: Record<string, unknown>;
  };
  type Edge = {
    sourceBlockId: string;
    targetBlockId: string;
  };

  const blocks = (args.workflow.blocks as Block[]) ?? [];
  const edges = (args.workflow.edges as Edge[]) ?? [];
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const incoming = new Map<string, Set<string>>();
  for (const b of blocks) incoming.set(b.id, new Set());
  for (const e of edges) {
    incoming.get(e.targetBlockId)?.add(e.sourceBlockId);
  }

  const outputs: Record<string, unknown> = {};
  const visited: string[] = [];

  // Seed: every block with no incoming edges. There may be more
  // than one trigger root in the future; we walk all of them.
  const ready: string[] = [];
  for (const [id, ins] of incoming) if (ins.size === 0) ready.push(id);

  // Compute outgoing edges per block for traversal.
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!outgoing.has(e.sourceBlockId)) outgoing.set(e.sourceBlockId, []);
    outgoing.get(e.sourceBlockId)!.push(e.targetBlockId);
  }
  const remainingIncoming = new Map(
    Array.from(incoming.entries()).map(([id, set]) => [id, new Set(set)]),
  );

  while (ready.length > 0) {
    const id = ready.shift()!;
    const block = blockMap.get(id);
    if (!block) continue;
    visited.push(id);

    const kind = block.kind ?? block.type ?? "tool";
    let blockOutput: unknown = {};

    try {
      if (kind === "trigger") {
        blockOutput = args.triggerPayload;
      } else if (kind === "tool") {
        if (!block.tool) {
          throw new Error(`Block ${id}: kind=tool requires a 'tool' field`);
        }
        const resolvedInputs = resolveTemplates(block.inputs ?? {}, outputs);
        const dispatched = await dispatch(
          { registry: args.registry, db: args.db },
          block.tool,
          resolvedInputs,
          { ...args.ctx, invokedBy: "workflow" },
        );
        if (!dispatched.result.ok) {
          return {
            outputs,
            visited,
            failed: { blockId: id, error: dispatched.result.error },
          };
        }
        blockOutput = dispatched.result.result;
      } else {
        // Unknown / deferred kinds — record the block ran but
        // didn't do anything. A future pass implements
        // condition / for_each / delay / transform / branch.
        blockOutput = { skipped: true, reason: `kind=${kind} not yet supported` };
      }
    } catch (e) {
      return {
        outputs,
        visited,
        failed: {
          blockId: id,
          error: { code: "internal", message: e instanceof Error ? e.message : String(e), retryable: false },
        },
      };
    }

    outputs[id] = blockOutput;

    // Mark this block as resolved for downstream nodes.
    for (const target of outgoing.get(id) ?? []) {
      const stillIn = remainingIncoming.get(target);
      if (!stillIn) continue;
      stillIn.delete(id);
      if (stillIn.size === 0) ready.push(target);
    }
  }

  return { outputs, visited };
}

/**
 * Resolve `{{nodeId.field}}` templates in the input object. Only
 * top-level string values are substituted; nested objects /
 * arrays are walked recursively. Numeric/boolean values pass
 * through. Phase 7 — minimal viable substitution.
 */
function resolveTemplates(
  inputs: unknown,
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      const match = /^\{\{([a-zA-Z0-9_.-]+)\}\}$/.exec(value);
      if (match) {
        const path = match[1].split(".");
        let cursor: unknown = outputs;
        for (const seg of path) {
          if (cursor && typeof cursor === "object" && seg in (cursor as object)) {
            cursor = (cursor as Record<string, unknown>)[seg];
          } else {
            return value;
          }
        }
        return cursor;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = visit(v);
      }
      return out;
    }
    return value;
  };
  const result = visit(inputs);
  return (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
}

export const createWorkflowModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;
  const toolRegistry = deps.toolRegistry as ToolRegistry | undefined;

  const listTool: Tool = {
    name: "list",
    description: "List workflows for the current tenant",
    inputs: z.object({}),
    async handler(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
      const rows = await db
        .select()
        .from(workflows)
        .where(eq(workflows.tenantId, ctx.tenantId));
      return { ok: true, result: { workflows: rows } };
    },
  };

  const getTool: Tool = {
    name: "get",
    description: "Read a workflow definition by id",
    inputs: z.object({ workflowId: z.string().uuid() }),
    async handler(
      input: { workflowId: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.workflowId))
        .limit(1);
      const wf = rows[0];
      if (!wf || wf.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "not_found", message: "Workflow not found", retryable: false },
        };
      }
      return { ok: true, result: { workflow: wf } };
    },
  };

  const getRunTool: Tool = {
    name: "get_run",
    description: "Read a specific workflow run with its per-block outputs",
    inputs: z.object({ runId: z.string().uuid() }),
    async handler(
      input: { runId: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, input.runId))
        .limit(1);
      const run = rows[0];
      if (!run || run.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "not_found", message: "Workflow run not found", retryable: false },
        };
      }
      return { ok: true, result: { run } };
    },
  };

  const runTool: Tool = {
    name: "run",
    description:
      "Execute a saved workflow. Walks the DAG, dispatches tools per block, returns per-block outputs.",
    inputs: z.object({
      workflowId: z.string().uuid(),
      triggerPayload: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: { workflowId: string; triggerPayload?: Record<string, unknown> },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!toolRegistry) {
        return {
          ok: false,
          error: {
            code: "internal",
            message:
              "workflow.run requires the v2 toolRegistry to be available in module factory deps. " +
              "Confirm the host's BoringOS init wires `toolRegistry` into ModuleFactoryDeps.",
            retryable: false,
          },
        };
      }
      const wfRows = await db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.workflowId))
        .limit(1);
      const workflow = wfRows[0];
      if (!workflow || workflow.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "not_found", message: "Workflow not found", retryable: false },
        };
      }

      // Open a workflow_runs row up-front so observability tools
      // see the run as soon as it starts.
      const runStartedAt = new Date();
      const inserted = await db
        .insert(workflowRuns)
        .values({
          tenantId: ctx.tenantId,
          workflowId: workflow.id,
          triggerType: "manual",
          triggerPayload: input.triggerPayload ?? {},
          status: "running",
          startedAt: runStartedAt,
        })
        .returning({ id: workflowRuns.id });
      const runId = inserted[0]?.id;

      const result = await runWorkflowDag({
        db,
        registry: toolRegistry,
        workflow: {
          id: workflow.id,
          blocks: workflow.blocks ?? [],
          edges: workflow.edges ?? [],
        },
        triggerPayload: input.triggerPayload ?? {},
        ctx,
      });

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - runStartedAt.getTime();

      if (result.failed) {
        if (runId) {
          await db
            .update(workflowRuns)
            .set({
              status: "failed",
              error: JSON.stringify(result.failed.error),
              finishedAt,
              durationMs,
            })
            .where(eq(workflowRuns.id, runId));
        }
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: `Workflow block ${result.failed.blockId} failed`,
            retryable: false,
            details: { blockId: result.failed.blockId, error: result.failed.error, outputs: result.outputs },
          },
        };
      }

      if (runId) {
        await db
          .update(workflowRuns)
          .set({ status: "completed", finishedAt, durationMs })
          .where(eq(workflowRuns.id, runId));
      }

      return {
        ok: true,
        result: { runId, outputs: result.outputs, visited: result.visited },
      };
    },
  };

  const module: Module = {
    id: "workflow",
    name: "Workflows",
    version: "0.1.0",
    description: "Saved DAGs of tool calls — list, inspect, run, get_run",
    provides: ["workflow-runtime"],
    skills: [
      {
        id: "workflow",
        source: "module",
        body: WORKFLOW_SKILL,
        priority: 70,
      },
    ],
    tools: [listTool, getTool, getRunTool, runTool],
  };

  return module;
};
