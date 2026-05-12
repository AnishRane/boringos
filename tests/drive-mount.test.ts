// task_23 F1 — drive-mount integration tests.
//
// Verifies the symlink-tree builder lands the right shape for each
// wake's human context. We construct a temp workdir + drive root,
// invoke injectDrive directly, then assert with realpath that
// reads through the mount hit the expected Drive bytes.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, rm, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { injectDrive } from "@boringos/agent";
import type { WakeContext } from "@boringos/agent";

describe("injectDrive", () => {
  let tmp: string;
  let driveRoot: string;
  const T = "tenant-A";
  const U = "user-U";
  const V = "user-V";
  const TASK = "task-1";

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "drive-mount-"));
    driveRoot = join(tmp, "drive");
    // Seed Drive content under each prefix so we can prove the
    // symlinks resolve to real bytes.
    await mkdir(join(driveRoot, T, "shared"), { recursive: true });
    await writeFile(join(driveRoot, T, "shared", "policy.md"), "tenant policy");

    await mkdir(join(driveRoot, T, "tasks", TASK), { recursive: true });
    await writeFile(join(driveRoot, T, "tasks", TASK, "log.md"), "task log");

    await mkdir(join(driveRoot, T, "users", U), { recursive: true });
    await writeFile(join(driveRoot, T, "users", U, "preferences.md"), "U prefers terse");

    await mkdir(join(driveRoot, T, "users", V), { recursive: true });
    await writeFile(join(driveRoot, T, "users", V, "preferences.md"), "V prefers verbose");
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("mounts shared + tasks/<active> + users/<owner> + me/ alias for a user-owned wake", async () => {
    const workDir = await mkdtemp(join(tmp, "workdir-A-"));
    const wakeContext: WakeContext = {
      ownerUserId: U,
      taskId: TASK,
      projectId: null,
      sessionId: null,
      tenantId: T,
    };

    await injectDrive({ workDir, driveRoot, wakeContext });

    // shared/ — readable, resolves to the real Drive path
    expect(existsSync(join(workDir, "drive", "shared"))).toBe(true);
    expect(await realpath(join(workDir, "drive", "shared"))).toBe(
      await realpath(join(driveRoot, T, "shared")),
    );
    expect(
      await readFile(join(workDir, "drive", "shared", "policy.md"), "utf8"),
    ).toBe("tenant policy");

    // tasks/<active>/
    expect(existsSync(join(workDir, "drive", "tasks", TASK))).toBe(true);
    expect(
      await readFile(join(workDir, "drive", "tasks", TASK, "log.md"), "utf8"),
    ).toBe("task log");

    // users/<owner>/
    expect(existsSync(join(workDir, "drive", "users", U))).toBe(true);
    expect(
      await readFile(
        join(workDir, "drive", "users", U, "preferences.md"),
        "utf8",
      ),
    ).toBe("U prefers terse");

    // ./drive/me/ — agent-friendly alias to the same dir, so the
    // agent never has to know its wake-owner's UUID.
    expect(existsSync(join(workDir, "drive", "me"))).toBe(true);
    expect(await realpath(join(workDir, "drive", "me"))).toBe(
      await realpath(join(driveRoot, T, "users", U)),
    );
    expect(
      await readFile(join(workDir, "drive", "me", "preferences.md"), "utf8"),
    ).toBe("U prefers terse");

    // CRITICAL — the OTHER user is NOT mounted, even though they
    // exist in the same tenant. Cross-user privacy via the mount.
    expect(existsSync(join(workDir, "drive", "users", V))).toBe(false);
  });

  it("omits users/* and me/ entirely when the wake has no human owner (routine)", async () => {
    const workDir = await mkdtemp(join(tmp, "workdir-B-"));
    const wakeContext: WakeContext = {
      ownerUserId: null,
      taskId: TASK,
      projectId: null,
      sessionId: null,
      tenantId: T,
    };

    await injectDrive({ workDir, driveRoot, wakeContext });

    expect(existsSync(join(workDir, "drive", "shared"))).toBe(true);
    expect(existsSync(join(workDir, "drive", "tasks", TASK))).toBe(true);
    // No users/ directory at all — not even an empty parent.
    expect(existsSync(join(workDir, "drive", "users"))).toBe(false);
    // me/ also absent — no human owner means no "me".
    expect(existsSync(join(workDir, "drive", "me"))).toBe(false);
  });

  it("a write through the mount hits the real Drive path", async () => {
    const workDir = await mkdtemp(join(tmp, "workdir-C-"));
    const wakeContext: WakeContext = {
      ownerUserId: U,
      taskId: TASK,
      projectId: null,
      sessionId: null,
      tenantId: T,
    };

    await injectDrive({ workDir, driveRoot, wakeContext });

    await writeFile(
      join(workDir, "drive", "users", U, "memory", "MEMORY.md"),
      "fresh memory",
    ).catch(async () => {
      // Auto-mkdir the parent then retry — agents would do this too.
      await mkdir(join(workDir, "drive", "users", U, "memory"), {
        recursive: true,
      });
      await writeFile(
        join(workDir, "drive", "users", U, "memory", "MEMORY.md"),
        "fresh memory",
      );
    });

    // Read it back from the REAL Drive path (not through the mount)
    // to prove the symlink forwarded the write correctly.
    expect(
      await readFile(join(driveRoot, T, "users", U, "memory", "MEMORY.md"), "utf8"),
    ).toBe("fresh memory");
  });

  it("auto-creates source dirs on the Drive root so symlinks point at real paths", async () => {
    // Brand-new owner with no Drive content yet — the mount should
    // still work (mkdir the source, then symlink).
    const W = "user-W-fresh";
    const workDir = await mkdtemp(join(tmp, "workdir-D-"));
    const wakeContext: WakeContext = {
      ownerUserId: W,
      taskId: TASK,
      projectId: null,
      sessionId: null,
      tenantId: T,
    };

    await injectDrive({ workDir, driveRoot, wakeContext });

    expect(existsSync(join(workDir, "drive", "users", W))).toBe(true);
    expect(existsSync(join(driveRoot, T, "users", W))).toBe(true);
  });
});
