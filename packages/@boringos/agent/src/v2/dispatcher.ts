// SPDX-License-Identifier: MIT
//
// v2 tool dispatcher — the single code path for invoking any
// registered Tool.
//
// Two callers:
//  - HTTP: `POST /api/tools/<full-name>` (mounted by core)
//  - In-process: workflow nodes, routines, lifecycle hooks
//
// Both go through `dispatch()`. It validates, runs the handler,
// times the call, persists a `tool_calls` audit row, and returns
// a typed result. Thrown errors become structured ToolErrors.
//
// Scope of Phase 2:
//  - Validation via the SchemaLike interface (real Zod schemas
//    satisfy it; mocks satisfy it for tests).
//  - Audit row writes (best-effort; failures don't block the call
//    but are logged to stderr).
//  - Error model exactly as specified in
//    docs/blockers/task_12_greenfield_rebuild.md §8.2.
//  - Idempotency, rate-limits, permissions: deferred to later
//    phases.

import type { Db } from "@boringos/db";
import { toolCalls } from "@boringos/db";
import type {
  Tool,
  ToolContext,
  ToolError,
  ToolErrorCode,
  ToolResult,
} from "@boringos/module-sdk";
import type { ToolRegistry } from "./tool-registry.js";

export interface DispatchResult<T = unknown> {
  /** HTTP-equivalent status; 200 for ok or business error,
   * 400 for validation failure, 404 for unknown tool, 500 for
   * internal. */
  status: number;
  result: ToolResult<T>;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** UUID of the audit row, if persistence succeeded. */
  toolCallId?: string;
}

export interface DispatchDeps {
  registry: ToolRegistry;
  db?: Db;
}

/**
 * Invoke a tool. The single entry point.
 */
export async function dispatch<TInput = unknown, TOutput = unknown>(
  deps: DispatchDeps,
  fullName: string,
  rawInputs: unknown,
  ctx: ToolContext,
  options: DispatchOptions = {},
): Promise<DispatchResult<TOutput>> {
  const startedAt = new Date();
  const start = Date.now();

  const tool = deps.registry.get(fullName) as Tool<TInput, TOutput> | undefined;
  if (!tool) {
    return finish(
      deps,
      ctx,
      fullName,
      undefined,
      "not_found",
      404,
      undefined,
      undefined,
      {
        ok: false,
        error: {
          code: "not_found",
          message: `Unknown tool "${fullName}".`,
          retryable: false,
        },
      },
      startedAt,
      Date.now() - start,
      options.idempotencyKey,
    );
  }

  // Resolve owning module id so the audit row carries it.
  const moduleId = fullName.includes(".")
    ? fullName.slice(0, fullName.indexOf("."))
    : "unknown";

  // Validate.
  const parsed = tool.inputs.safeParse(rawInputs);
  if (!parsed.success) {
    const errorPayload: ToolError = {
      code: "invalid_input",
      message: parsed.error?.message ?? "Input failed validation.",
      retryable: false,
      details: parsed.error?.issues,
    };
    return finish(
      deps,
      ctx,
      fullName,
      moduleId,
      "validation_failed",
      400,
      rawInputs,
      undefined,
      { ok: false, error: errorPayload },
      startedAt,
      Date.now() - start,
      options.idempotencyKey,
    );
  }

  // Run the handler with everything caught.
  let result: ToolResult<TOutput>;
  let status: AuditStatus;
  let httpStatus: number;
  try {
    result = await tool.handler(parsed.data, ctx);
    if (result.ok) {
      status = "ok";
      httpStatus = 200;
    } else {
      status = "error";
      httpStatus = 200; // business error — handler returned cleanly
    }
  } catch (thrown) {
    const message =
      thrown instanceof Error
        ? thrown.message
        : typeof thrown === "string"
          ? thrown
          : "Tool handler threw an uncaught error.";
    result = {
      ok: false,
      error: {
        code: "internal",
        message,
        retryable: false,
      },
    };
    status = "internal";
    httpStatus = 500;
  }

  return finish(
    deps,
    ctx,
    fullName,
    moduleId,
    status,
    httpStatus,
    parsed.data,
    result.ok ? result.result : undefined,
    result,
    startedAt,
    Date.now() - start,
    options.idempotencyKey,
  );
}

export interface DispatchOptions {
  idempotencyKey?: string;
}

type AuditStatus =
  | "ok"
  | "error"
  | "validation_failed"
  | "permission_denied"
  | "not_found"
  | "internal";

async function finish<T>(
  deps: DispatchDeps,
  ctx: ToolContext,
  fullName: string,
  moduleId: string | undefined,
  status: AuditStatus,
  httpStatus: number,
  inputs: unknown,
  resultBody: unknown,
  result: ToolResult<T>,
  startedAt: Date,
  durationMs: number,
  idempotencyKey: string | undefined,
): Promise<DispatchResult<T>> {
  const endedAt = new Date();
  let toolCallId: string | undefined;
  if (deps.db) {
    try {
      const inserted = await deps.db
        .insert(toolCalls)
        .values({
          tenantId: ctx.tenantId,
          toolName: fullName,
          moduleId: moduleId ?? "unknown",
          invokedBy: ctx.invokedBy,
          agentId: ctx.agentId,
          runId: ctx.runId,
          taskId: ctx.taskId,
          inputs: isPojo(inputs) ? (inputs as Record<string, unknown>) : undefined,
          result: isPojo(resultBody) ? (resultBody as Record<string, unknown>) : undefined,
          error:
            !result.ok && isPojo(result.error)
              ? (result.error as unknown as Record<string, unknown>)
              : undefined,
          status,
          durationMs,
          idempotencyKey,
          startedAt,
          endedAt,
        })
        .returning({ id: toolCalls.id });
      toolCallId = inserted[0]?.id;
    } catch (auditError) {
      // Persistence failures must not block the call. Surface
      // to stderr so ops can notice.
      // eslint-disable-next-line no-console
      console.error(
        `[v2-dispatcher] failed to persist tool_calls row for ${fullName}:`,
        auditError,
      );
    }
  }
  return { status: httpStatus, result, durationMs, toolCallId };
}

function isPojo(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Convenience helper for callers who just want the result body.
 * Throws on internal errors so business code doesn't have to
 * handle them as data.
 */
export async function invoke<TInput = unknown, TOutput = unknown>(
  deps: DispatchDeps,
  fullName: string,
  inputs: TInput,
  ctx: ToolContext,
  options?: DispatchOptions,
): Promise<ToolResult<TOutput>> {
  const dispatched = await dispatch<TInput, TOutput>(
    deps,
    fullName,
    inputs,
    ctx,
    options,
  );
  if (
    !dispatched.result.ok &&
    dispatched.result.error.code === "internal"
  ) {
    throw new Error(
      `[v2-dispatcher] internal error invoking "${fullName}": ${dispatched.result.error.message}`,
    );
  }
  return dispatched.result;
}

// Re-export for callers
export type { ToolErrorCode };
