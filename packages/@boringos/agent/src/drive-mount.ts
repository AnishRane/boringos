// task_23 F1 — Drive workdir mount.
//
// Materialises the Drive slice that the wake's human context can see
// as a symlink tree under `<workDir>/drive/`. The agent's CLI tools
// (Read, Grep, Glob, Bash) then operate on Drive content natively —
// no tool-call round-trip per read, search composes with shell
// pipelines, no new RPC surface to ship.
//
// What gets mounted is driven by the WakeContext, not by the agent's
// identity:
//
//   shared/                — always (tenant-wide lane)
//   tasks/<activeTaskId>/  — every wake is task-bound, so always
//   users/<ownerUserId>/   — only when the wake has a human owner
//   projects/<projectId>/  — only when the task belongs to a project
//
// A routine / cron / webhook wake with no human owner sees no
// `users/*` directory at all — cross-user privacy within the tenant
// falls out of the mount, not from new ACL code in tool dispatch.
//
// Reads through symlinks hit the real Drive storage with zero
// framework involvement. Writes do too — the bytes land at exactly
// the path a `drive.write` tool call would have used. The one
// tradeoff is SSE: writes via the mount don't fire the realtime bus,
// because there's no interception point. The auto-checkpoint hook
// (task_24 M3) emits a single batched event on run finalisation,
// which covers the common case for the UI.

import { existsSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { WakeContext } from "./wake-context.js";

export interface DriveMountOpts {
  /** The per-run workdir produced by provisionRunWorkdir. */
  workDir: string;
  /** Local-FS root the Drive backend writes into. Tenants live as
   * sub-directories of this root: `<driveRoot>/<tenantId>/...`. */
  driveRoot: string;
  /** Wake-context resolved at the start of executeJob. The mount
   *  shape is decided here — owner null ⇒ no users/* symlink. */
  wakeContext: WakeContext;
}

/**
 * Build the `<workDir>/drive/` symlink tree.
 *
 * Sources that don't yet exist on disk are `mkdir -p`'d before the
 * symlink is created — otherwise the symlink would point at a
 * non-existent path and the first read would ENOENT. The mkdir is
 * cheap (no-op when present) and means an agent can `echo "x" >
 * drive/users/<owner>/notes.md` without first having to `mkdir`
 * a path Drive would have lazily created on the first tool call.
 *
 * Symlinks are absolute, by design. Workdir parent-relative
 * symlinks would break if the workdir ever moves; absolute paths
 * stay valid as long as the Drive root stays in place (and we
 * tear down the workdir on every run, so cross-run drift is
 * impossible).
 */
export async function injectDrive(opts: DriveMountOpts): Promise<void> {
  const { workDir, driveRoot, wakeContext } = opts;

  // The agent sees its data at <workDir>/drive/. Build the scaffold.
  const mountRoot = join(workDir, "drive");
  await mkdir(mountRoot, { recursive: true });

  const tenantRoot = resolve(driveRoot, wakeContext.tenantId);

  // Every wake gets shared/ and tasks/<active>/. These are
  // tenant-shared by ACL (drive-acl.ts); the mount mirrors that.
  await linkPrefix({
    src: join(tenantRoot, "shared"),
    dest: join(mountRoot, "shared"),
  });

  await linkPrefix({
    src: join(tenantRoot, "tasks", wakeContext.taskId),
    dest: join(mountRoot, "tasks", wakeContext.taskId),
    parents: [join(mountRoot, "tasks")],
  });

  // Owner-scoped: only when the wake has a resolvable human owner.
  // Routine / cron / webhook wakes skip this branch entirely —
  // they cannot reach any `users/*` directory through the mount.
  //
  // We expose the wake-owner's directory at TWO paths under the
  // mount:
  //   1) the canonical `./drive/users/<uuid>/` — preserves the
  //      Drive's real structure so any documentation/diagrams that
  //      reference users/<id>/ paths work natively
  //   2) the agent-friendly alias `./drive/me/` — the SKILL points
  //      agents at this. Agents never need to know their wake-
  //      owner's UUID; they always reach memory at ./drive/me/.
  //
  // Both point at the same on-disk bytes. Symlinks are cheap.
  if (wakeContext.ownerUserId) {
    await linkPrefix({
      src: join(tenantRoot, "users", wakeContext.ownerUserId),
      dest: join(mountRoot, "users", wakeContext.ownerUserId),
      parents: [join(mountRoot, "users")],
    });
    await linkPrefix({
      src: join(tenantRoot, "users", wakeContext.ownerUserId),
      dest: join(mountRoot, "me"),
    });
  }

  // Project: links to the active task's project, when applicable.
  // The WakeContext.projectId is null until the tasks table grows
  // a project link; the resolver leaves a clean extension point.
  if (wakeContext.projectId) {
    await linkPrefix({
      src: join(tenantRoot, "projects", wakeContext.projectId),
      dest: join(mountRoot, "projects", wakeContext.projectId),
      parents: [join(mountRoot, "projects")],
    });
  }
}

interface LinkPrefixOpts {
  src: string;
  dest: string;
  /** Extra parent dirs to create before the link (e.g.
   *  `<mountRoot>/tasks` for a `tasks/<id>` leaf). */
  parents?: string[];
}

/**
 * Ensure the source exists on disk, ensure the destination's parent
 * dirs exist, then create the symlink. The `'dir'` type matters on
 * Windows (which we don't target) and is harmless elsewhere. If
 * the destination already exists (re-run on the same workdir, or
 * stale crash residue), we leave it alone — the workdir is
 * per-run, so this should never happen in practice.
 */
async function linkPrefix(opts: LinkPrefixOpts): Promise<void> {
  await mkdir(opts.src, { recursive: true });
  for (const p of opts.parents ?? []) {
    await mkdir(p, { recursive: true });
  }
  if (existsSync(opts.dest)) return;
  await symlink(opts.src, opts.dest, "dir");
}
