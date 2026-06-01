// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Drive index reconciler — walks a tenant's on-disk Drive slice and
// upserts any file the `driveFiles` Postgres index is missing or has
// stale metadata for.
//
// Why this exists: the filesystem (`.data/drive/<tenantId>/...`) is the
// source of truth for content; `driveFiles` is a derived metadata cache
// that powers `/api/admin/drive/list` (cheap listing + ETags + memory-
// sync tracking). Several writers bypass `DriveManager.write` and hit
// the filesystem directly, so the cache drifts and the dashboard shows a
// near-empty tenant even though the brain has grown:
//   - the auto-checkpoint hook appending `tasks/<id>/log.md`,
//   - agent `Edit`/`Write` on the workdir symlink for non-memory paths
//     (the checkpoint's reindex only walks `**/memory/**`).
//
// Rather than chase every bypassing writer, this reconciler treats the
// filesystem as authoritative and makes the index self-healing: walk the
// slice, and for every real file either insert a missing row or refresh a
// row whose size no longer matches disk (e.g. an appended log). It only
// reads + hashes files that are new or changed, so the steady state costs
// one `stat` per file, not a full re-hash. See `docs/drive_issues.md` #4.

import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import type { Db } from "@boringos/db";
import type { StorageBackend } from "@boringos/drive";

export interface ReconcileDeps {
  db: Db;
  drive: StorageBackend;
}

export interface ReconcileResult {
  /** Files inserted into the index that were missing. */
  inserted: number;
  /** Files whose stale metadata (size/hash) was refreshed. */
  updated: number;
  /** Total real files seen on disk under the tenant slice. */
  scanned: number;
}

// Safety cap so a pathological tree can't melt the reconcile. Matches the
// spirit of the memory-checkpoint reindex bound. A tenant with more files
// than this still lists fine (the index query is unbounded) — it just
// won't auto-heal beyond the cap in a single pass.
const MAX_FILES = 5000;

function computeHash(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function getFormat(path: string): string | null {
  const ext = extname(path).toLowerCase();
  return ext ? ext.slice(1) : null;
}

/**
 * Walk the tenant's Drive slice and upsert any file missing from — or
 * stale in — the `driveFiles` index. Idempotent and best-effort: a
 * per-file failure (read race, transient FS error) is swallowed so the
 * walk continues, and the function never throws into the caller. Returns
 * counts for observability/tests.
 */
export async function reconcileDriveIndex(
  deps: ReconcileDeps,
  tenantId: string,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { inserted: 0, updated: 0, scanned: 0 };

  const { eq, and } = await import("drizzle-orm");
  const { driveFiles } = await import("@boringos/db");
  const { generateId } = await import("@boringos/shared");

  // Snapshot the current index: canonical path → { id, size }.
  const indexRows = await deps.db
    .select()
    .from(driveFiles)
    .where(eq(driveFiles.tenantId, tenantId));
  const indexed = new Map<string, { id: string; size: number }>();
  for (const r of indexRows) indexed.set(r.path, { id: r.id, size: r.size });

  // Recursively collect every real file under `<tenantId>/...`. The
  // storage `list` is shallow (one directory level), so we descend
  // explicitly. Paths come back relative to the storage root, i.e.
  // `<tenantId>/<path>`; we strip the tenant prefix to get the canonical
  // Drive path the index uses.
  const tenantPrefix = `${tenantId}/`;
  const files: string[] = []; // canonical drive paths
  const queue: string[] = [tenantId];

  while (queue.length > 0 && files.length < MAX_FILES) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await deps.drive.list(dir);
    } catch {
      continue; // unreadable directory — skip, keep walking
    }
    for (const entry of entries) {
      // Skip dotfiles/dirs (e.g. `.drive-skill.md`) — `DriveManager`
      // never indexes them, so neither should the reconciler.
      if (basename(entry.path).startsWith(".")) continue;
      if (entry.isDirectory) {
        queue.push(entry.path);
        continue;
      }
      if (!entry.path.startsWith(tenantPrefix)) continue;
      files.push(entry.path.slice(tenantPrefix.length));
      if (files.length >= MAX_FILES) break;
    }
  }

  for (const path of files) {
    result.scanned++;
    const existing = indexed.get(path);

    // Cheap path: stat-only size check. If the row exists and the size
    // matches disk, assume unchanged and skip the read+hash entirely.
    let diskSize: number | null = null;
    try {
      const s = await deps.drive.stat(`${tenantId}/${path}`);
      diskSize = s?.size ?? null;
    } catch {
      diskSize = null;
    }
    if (existing && diskSize !== null && existing.size === diskSize) continue;

    // New or changed file — read once to compute the authoritative
    // size/hash, then upsert.
    let bytes: Uint8Array;
    try {
      bytes = await deps.drive.read(`${tenantId}/${path}`);
    } catch {
      continue; // vanished between walk and read — ignore
    }
    const size = bytes.byteLength;
    const hash = computeHash(bytes);
    const format = getFormat(path);
    const filename = basename(path);

    try {
      if (existing) {
        await deps.db
          .update(driveFiles)
          .set({ size, hash, format, updatedAt: new Date() })
          .where(eq(driveFiles.id, existing.id));
        result.updated++;
      } else {
        await deps.db
          .insert(driveFiles)
          .values({ id: generateId(), tenantId, path, filename, format, size, hash });
        result.inserted++;
        indexed.set(path, { id: "", size });
      }
    } catch {
      // Likely a unique-constraint race with a concurrent
      // `DriveManager.write` for the same (tenant, path). The other
      // writer's row is authoritative; fall back to a size/hash refresh.
      try {
        await deps.db
          .update(driveFiles)
          .set({ size, hash, format, updatedAt: new Date() })
          .where(and(eq(driveFiles.tenantId, tenantId), eq(driveFiles.path, path)));
      } catch {
        /* best-effort — give up on this file, keep reconciling */
      }
    }
  }

  return result;
}
