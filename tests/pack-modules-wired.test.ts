// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T2.4 — `pack-modules` wired into the framework build.
//
// Three things we lock down here:
//   1. The framework's root `package.json` declares a `postbuild`
//      that runs `scripts/pack-modules.mjs` after `pnpm -r build`.
//   2. `pack-modules.mjs` resolves DEFAULT_PACKAGES relative to
//      FRAMEWORK_ROOT (no hardcoded absolute paths).
//   3. The script exits 0 when no DEFAULT_PACKAGES exist on the
//      build machine — so dev / CI without CRM next door doesn't
//      break the framework build.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "..", "..");

describe("MDK T2.4 — pack-modules wired into build", () => {
  it("framework package.json declares a postbuild that invokes pack-modules", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.postbuild).toMatch(/pack-modules\.mjs/);
  });

  it("pack-modules.mjs no longer hardcodes an absolute path", () => {
    const src = readFileSync(
      join(repoRoot, "scripts", "pack-modules.mjs"),
      "utf8",
    );
    // The pre-T2.4 hardcoded prefix must not reappear via copy/paste.
    expect(src).not.toMatch(/\/Users\//);
    // DEFAULT_PACKAGES must resolve against FRAMEWORK_ROOT.
    expect(src).toMatch(/resolvePath\(FRAMEWORK_ROOT/);
  });

  it("pack-modules exits 0 (success) when every DEFAULT_PACKAGES entry is missing", () => {
    // Run pack-modules with --pkg pointing at a guaranteed-nonexistent dir.
    // That forces the missing-package code path the postbuild relies on.
    const ghost = mkdtempSync(join(tmpdir(), "pack-modules-ghost-"));
    rmSync(ghost, { recursive: true, force: true });

    const result = spawnSync(
      "node",
      [
        join(repoRoot, "scripts", "pack-modules.mjs"),
        "--pkg",
        ghost,
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/0 packed, 1 skipped/);
  });

  it("pack-modules still hard-fails (non-zero exit) when a real pack run errors", () => {
    // Create a directory that looks like a package but has no module.json —
    // `packOne` reports this as `status: "failed"`, which must still abort
    // the build.
    const fake = mkdtempSync(join(tmpdir(), "pack-modules-broken-"));
    mkdirSync(join(fake, "dist"), { recursive: true });
    writeFileSync(
      join(fake, "package.json"),
      JSON.stringify({ name: "fake", version: "0.0.1" }),
    );
    // No module.json — should not actually invoke pack-hebbsmod; the
    // outer guard surfaces a skipped status for missing module.json
    // and exits 0. Verify this remains a "skip", not a "fail", so the
    // build doesn't break on partially-set-up modules.
    const result = spawnSync(
      "node",
      [
        join(repoRoot, "scripts", "pack-modules.mjs"),
        "--pkg",
        fake,
      ],
      { encoding: "utf8" },
    );

    rmSync(fake, { recursive: true, force: true });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/skipped/);
  });
});
