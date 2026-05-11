// SPDX-License-Identifier: BUSL-1.1
//
// workflow schema as the shell understands it. Mirrors the
// shape persisted in `workflows.{blocks,edges}` and consumed by
// `workflow.run` in @boringos/core/modules/workflow.ts.

export type BlockKind =
  | "trigger"
  | "tool"
  | "condition"
  | "for_each"
  | "delay"
  | "transform"
  | "branch"
  | "sticky"
  | "agent";

export interface Block {
  id: string;
  kind?: BlockKind | string;
  /** Legacy  rows still in DB use `type` instead of `kind`. */
  type?: string;
  /** For `kind: "tool"` — fully qualified `<module>.<tool>` name. */
  tool?: string;
  inputs?: Record<string, unknown>;
  config?: Record<string, unknown>;
  /** Optional friendly label rendered on the node. */
  name?: string;
  /** Cached canvas position (x, y) for layout persistence. */
  position?: { x: number; y: number };
}

export interface Edge {
  /** Optional client-side id; backend doesn't require it but we use it for React keys. */
  id?: string;
  sourceBlockId: string;
  targetBlockId: string;
  /** For condition: "true" | "false". */
  sourceHandle?: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description?: string | null;
  type?: string;
  status?: string;
  blocks?: Block[];
  edges?: Edge[];
  governingAgentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ToolRow {
  fullName: string;
  moduleId: string;
  description: string;
  idempotency?: string;
  costHint?: string;
}

export interface ModuleRow {
  id: string;
  name: string;
  description: string;
  tools: { name: string; description: string }[];
}

/**
 * Per-block runtime status during/after a run. Used by Canvas in run
 * mode to overlay status dots on nodes. Mirrors `workflow_block_runs`.
 */
export type BlockRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped"
  | "failed"
  | "waiting";

export interface BlockRun {
  blockId: string;
  status: BlockRunStatus;
  durationMs?: number | null;
  error?: string | null;
  output?: Record<string, unknown> | null;
  resolvedConfig?: Record<string, unknown> | null;
  inputContext?: Record<string, unknown> | null;
}
