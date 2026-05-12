// task_24 F — auto-checkpoint hook.
//
// Every run finalisation (success or failure) appends a structured
// entry to the work's log file:
//
//   tasks/<taskId>/log.md                      — task-bound work
//   users/<ownerUserId>/sessions/<sid>.md      — copilot session
//
// Routing rule: a session log wins when we have both ownerUserId
// AND sessionId (copilot threads are user-context-rich, the
// session log is where the user expects to find the trace). All
// other task-bound wakes route to the task log.
//
// The hook **never** writes to MEMORY.md or decisions/ — promotion
// to durable surfaces is the agent's deliberate call, made on the
// NEXT wake when it reads the log and decides what's worth keeping.
// This preserves OpenClaw's "log first, promote second" principle:
// the framework owns the log (cannot be skipped); the agent owns
// the promotion (intentional, deliberate, taught by SKILL).
//
// Failures are best-effort: a Drive write error here must never
// mask the run's actual outcome. The engine has already returned
// the result to the caller by the time these hooks fire.

import type { StorageBackend } from "@boringos/drive";
import type { AfterRunEvent, RunErrorEvent } from "./types.js";

export interface MemoryCheckpointDeps {
  drive: StorageBackend;
}

export interface MemoryCheckpoint {
  onRunFinished(event: AfterRunEvent): Promise<void>;
  onRunFailed(event: RunErrorEvent): Promise<void>;
}

/**
 * Build the auto-checkpoint subscribers. Register them on the
 * engine's `afterRun` and `onError` hooks.
 */
export function createMemoryCheckpoint(
  deps: MemoryCheckpointDeps,
): MemoryCheckpoint {
  const { drive } = deps;

  async function appendEntry(
    tenantId: string,
    destPath: string,
    body: string,
  ): Promise<void> {
    try {
      const fullPath = `${tenantId}/${destPath}`;
      let existing = "";
      if (await drive.exists(fullPath)) {
        existing = await drive.readText(fullPath);
        if (existing.length > 0 && !existing.endsWith("\n")) existing += "\n";
      } else {
        // Lay down a tiny header so a `cat log.md` from the agent's
        // workdir is self-explanatory rather than starting mid-trace.
        existing = headerFor(destPath);
      }
      await drive.write(fullPath, existing + body);
    } catch {
      // Best-effort. Real-world: a Drive write race on a high-QPS
      // tenant could lose at most the latest checkpoint. Cheap to
      // swallow; expensive to surface.
    }
  }

  function destinationFor(opts: {
    taskId?: string;
    ownerUserId?: string;
    sessionId?: string;
  }): string | null {
    // Session log wins when both pieces are present — copilot
    // session activity belongs under the user's namespace.
    if (opts.ownerUserId && opts.sessionId) {
      return `users/${opts.ownerUserId}/sessions/${opts.sessionId}.md`;
    }
    if (opts.taskId) {
      return `tasks/${opts.taskId}/log.md`;
    }
    return null;
  }

  return {
    async onRunFinished(event: AfterRunEvent): Promise<void> {
      const dest = destinationFor({
        taskId: event.taskId,
        ownerUserId: event.ownerUserId,
        sessionId: event.sessionId,
      });
      if (!dest) return;

      const outcome = event.result.exitCode === 0 ? "success" : "failed";
      const entry = renderEntry({
        timestamp: new Date(),
        runId: event.runId,
        agentId: event.agentId,
        outcome,
        body:
          event.result.errorMessage ??
          (event.result.exitCode === 0
            ? "Run completed."
            : `Exit code ${event.result.exitCode}.`),
      });
      await appendEntry(event.tenantId, dest, entry);
    },

    async onRunFailed(event: RunErrorEvent): Promise<void> {
      const dest = destinationFor({
        taskId: event.taskId,
        ownerUserId: event.ownerUserId,
        sessionId: event.sessionId,
      });
      if (!dest) return;

      const entry = renderEntry({
        timestamp: new Date(),
        runId: event.runId,
        agentId: event.agentId,
        outcome: "error",
        body: event.error.message,
      });
      await appendEntry(event.tenantId, dest, entry);
    },
  };
}

function renderEntry(fields: {
  timestamp: Date;
  runId: string;
  agentId: string;
  outcome: "success" | "failed" | "error";
  body: string;
}): string {
  const ts = fields.timestamp.toISOString();
  // Grep-friendly: every entry starts with a level-2 heading whose
  // first three space-separated tokens are sortable timestamp,
  // run id, and outcome. `grep "^## " log.md` lists the index.
  return [
    "",
    `## ${ts} — run ${fields.runId} — ${fields.outcome}`,
    `agent: ${fields.agentId}`,
    "",
    fields.body.trim(),
    "",
  ].join("\n");
}

function headerFor(destPath: string): string {
  if (destPath.startsWith("users/")) {
    return (
      "# Session log\n\n" +
      "Append-only trace of agent runs in this copilot session. Each entry\n" +
      "is a level-2 heading you can grep for: timestamp, run id, outcome.\n\n"
    );
  }
  return (
    "# Task log\n\n" +
    "Append-only trace of agent runs on this task. Each entry is a level-2\n" +
    "heading you can grep for: timestamp, run id, outcome.\n\n"
  );
}
