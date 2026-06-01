/**
 * Idle-watchdog regression (drive_issues #10).
 *
 * A hung CLI subprocess that goes silent must be killed by the generic
 * idle watchdog in `spawnAgent` — not left running, which would orphan the
 * `agent_runs` row in `status='running'` until the next server restart.
 * The watchdog keys off stdout/stderr activity, so it's runtime-agnostic.
 */
import { describe, it, expect } from "vitest";
import { spawnAgent } from "@boringos/runtime";

describe("spawnAgent idle watchdog", () => {
  it("kills a process that goes silent past the idle window", async () => {
    const start = Date.now();
    // `sleep 30` emits nothing and would otherwise run for 30s. The 250ms
    // idle window should kill it almost immediately.
    const result = await spawnAgent({
      command: "sleep",
      args: ["30"],
      cwd: process.cwd(),
      env: {},
      idleTimeoutMs: 250,
    });
    const elapsed = Date.now() - start;

    expect(result.idleTimedOut).toBe(true);
    expect(result.exitCode).not.toBe(0); // killed → non-zero → run marked failed
    expect(elapsed).toBeLessThan(10_000); // killed fast, nowhere near sleep 30
  }, 15_000);

  it("does NOT kill a process that keeps emitting output within the window", async () => {
    // Emits a line every ~50ms for ~500ms — always active inside a 400ms
    // idle window, so the watchdog must never fire.
    const script = "for i in 1 2 3 4 5 6 7 8 9 10; do echo tick $i; sleep 0.05; done";
    const result = await spawnAgent({
      command: "bash",
      args: ["-c", script],
      cwd: process.cwd(),
      env: {},
      idleTimeoutMs: 400,
    });

    expect(result.idleTimedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("tick 10");
  }, 15_000);

  it("treats idleTimeoutMs=0 as disabled", async () => {
    const result = await spawnAgent({
      command: "bash",
      args: ["-c", "sleep 0.3; echo done"],
      cwd: process.cwd(),
      env: {},
      idleTimeoutMs: 0, // disabled — must not kill despite 300ms of silence
    });

    expect(result.idleTimedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("done");
  }, 15_000);
});
