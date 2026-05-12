// task_25 G1 + G2 — auto-checkpoint embeds agent reply + reindex.
//
// G1: the log entry's body is the agent's final assistant message
//     extracted from stream-json, not "Run completed."
// G2: filesystem writes the agent made during a run get upserted
//     into drive_files so drive.search / the UI can find them.
//
// Uses embedded Postgres + a real local-FS drive backend so the
// reindex path actually upserts rows and we can assert against the
// driveFiles table.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, and } from "drizzle-orm";

describe("memory checkpoint — G1 reply embed + G2 reindex", () => {
  let app: import("@boringos/core").BoringOS;
  let server: { url: string };
  let db: import("@boringos/db").Db;
  let drive: ReturnType<typeof import("@boringos/drive").createLocalStorage>;
  let dataDir: string;
  let driveRoot: string;
  let checkpoint: import("@boringos/agent").MemoryCheckpoint;

  const T = "88888888-8888-4888-8888-888888888881";
  const A = "88888888-8888-4888-8888-888888888882";
  const U = "88888888-8888-4888-8888-888888888883";

  beforeAll(async () => {
    const { BoringOS } = await import("@boringos/core");
    const { createMemoryCheckpoint } = await import("@boringos/agent");
    const { createLocalStorage } = await import("@boringos/drive");

    dataDir = await mkdtemp(join(tmpdir(), "ck-g1g2-"));
    driveRoot = join(dataDir, "drive");
    // Isolate boot-time module hydration.
    process.env.MODULES_STORE_DIR = join(dataDir, "module-store");

    app = new BoringOS({
      database: { embedded: true, dataDir, port: 5594 },
      drive: { root: driveRoot },
      auth: { secret: "ck-g1g2" },
    });
    server = await app.listen(0);
    db = (server as unknown as { context: { db: import("@boringos/db").Db } })
      .context.db;
    drive = createLocalStorage({ root: driveRoot });

    const { tenants, agents } = await import("@boringos/db");
    await db
      .insert(tenants)
      .values({ id: T, name: "T", slug: "t-g1g2" })
      .onConflictDoNothing();
    await db
      .insert(agents)
      .values({ id: A, tenantId: T, name: "A", role: "general" })
      .onConflictDoNothing();

    checkpoint = createMemoryCheckpoint({ drive, db });
  });

  afterAll(async () => {
    await app?.close?.();
  });

  it("G1: extracts the agent's reply from stream-json and embeds it in the log", async () => {
    const { agentRuns } = await import("@boringos/db");
    const runId = "99999999-9999-4999-8999-999999999911";
    const taskId = "99999999-9999-4999-8999-999999999921";

    // Seed an agent_runs row with a realistic stream-json excerpt.
    // The agent reply lives in the `result` field of the final
    // type=result line.
    const excerpt = [
      JSON.stringify({ type: "assistant", text: "thinking…" }),
      JSON.stringify({
        type: "result",
        result:
          "Saved your preference for terse responses to decisions/communication-style.md.",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    ].join("\n");

    await db.insert(agentRuns).values({
      id: runId,
      tenantId: T,
      agentId: A,
      status: "done",
      startedAt: new Date(Date.now() - 1000),
      endedAt: new Date(),
      stdoutExcerpt: excerpt,
    } as never);

    await checkpoint.onRunFinished({
      runId,
      tenantId: T,
      agentId: A,
      taskId,
      ownerUserId: U,
      sessionId: undefined,
      result: { exitCode: 0 },
    });

    const log = await drive.readText(`${T}/tasks/${taskId}/log.md`);
    expect(log).toContain("Saved your preference for terse responses");
    expect(log).not.toContain("Run completed.");
    // Header + entry shape intact.
    expect(log).toContain("# Task log");
    expect(log).toContain(`run ${runId}`);
  });

  it("G1: truncates large replies", async () => {
    const { agentRuns } = await import("@boringos/db");
    const runId = "99999999-9999-4999-8999-999999999912";
    const taskId = "99999999-9999-4999-8999-999999999922";
    const longReply = "x".repeat(8000);
    const excerpt = JSON.stringify({ type: "result", result: longReply });

    await db.insert(agentRuns).values({
      id: runId,
      tenantId: T,
      agentId: A,
      status: "done",
      startedAt: new Date(Date.now() - 1000),
      endedAt: new Date(),
      stdoutExcerpt: excerpt,
    } as never);

    await checkpoint.onRunFinished({
      runId,
      tenantId: T,
      agentId: A,
      taskId,
      result: { exitCode: 0 },
    });

    const log = await drive.readText(`${T}/tasks/${taskId}/log.md`);
    expect(log).toContain("…(truncated)");
    expect(log.length).toBeLessThan(8200);
  });

  it("G1: falls back to errorMessage when stream-json isn't parseable", async () => {
    const { agentRuns } = await import("@boringos/db");
    const runId = "99999999-9999-4999-8999-999999999913";
    const taskId = "99999999-9999-4999-8999-999999999923";

    await db.insert(agentRuns).values({
      id: runId,
      tenantId: T,
      agentId: A,
      status: "failed",
      startedAt: new Date(Date.now() - 1000),
      endedAt: new Date(),
      stdoutExcerpt: null,
    } as never);

    await checkpoint.onRunFinished({
      runId,
      tenantId: T,
      agentId: A,
      taskId,
      result: { exitCode: 1, errorMessage: "model rate limited" },
    });

    const log = await drive.readText(`${T}/tasks/${taskId}/log.md`);
    expect(log).toContain("model rate limited");
    expect(log).toContain("failed");
  });

  it("G2: indexes memory files the agent wrote during the run", async () => {
    const { agentRuns, driveFiles } = await import("@boringos/db");
    const runId = "99999999-9999-4999-8999-999999999931";
    const taskId = "99999999-9999-4999-8999-999999999941";
    const runStart = new Date(Date.now() - 1000);

    // Seed run row with a start time we'll filter against.
    await db.insert(agentRuns).values({
      id: runId,
      tenantId: T,
      agentId: A,
      status: "done",
      startedAt: runStart,
      endedAt: new Date(),
      stdoutExcerpt: JSON.stringify({ type: "result", result: "ok" }),
    } as never);

    // Simulate the agent writing a decision file via the workdir
    // mount (no tool call, no drive_files row yet).
    const decisionsDir = join(driveRoot, T, "users", U, "memory", "decisions");
    await mkdir(decisionsDir, { recursive: true });
    await writeFile(
      join(decisionsDir, "communication-style.md"),
      "# Communication style\n\nTerse, no preamble.\n",
    );

    // Confirm no index row yet.
    const beforeRows = await db
      .select()
      .from(driveFiles)
      .where(
        and(
          eq(driveFiles.tenantId, T),
          eq(
            driveFiles.path,
            `users/${U}/memory/decisions/communication-style.md`,
          ),
        ),
      );
    expect(beforeRows.length).toBe(0);

    await checkpoint.onRunFinished({
      runId,
      tenantId: T,
      agentId: A,
      taskId,
      ownerUserId: U,
      result: { exitCode: 0 },
    });

    // After checkpoint: index row should exist.
    const afterRows = await db
      .select()
      .from(driveFiles)
      .where(
        and(
          eq(driveFiles.tenantId, T),
          eq(
            driveFiles.path,
            `users/${U}/memory/decisions/communication-style.md`,
          ),
        ),
      );
    expect(afterRows.length).toBe(1);
    expect(afterRows[0].filename).toBe("communication-style.md");
    expect(afterRows[0].format).toBe("md");
    expect(afterRows[0].size).toBeGreaterThan(0);
  });

});
