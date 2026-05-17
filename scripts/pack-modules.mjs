#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// pack-modules — workspace-level orchestrator that packs every
// standalone Module package into a `.hebbsmod` via the
// `pack-hebbsmod` CLI (packages/@boringos/module-sdk).
//
// Why this exists:
//   Standalone Module packages live OUTSIDE this workspace (separate
//   repos linked in via `link:`). This orchestrator iterates a known
//   set of package paths, invokes `pack-hebbsmod --pkg <path>` for
//   each, and prints a summary table.
//
// Usage:
//   pnpm pack:modules                                # uses DEFAULT_PACKAGES
//   pnpm pack:modules -- --pkg /abs/path/one         # override with CLI args
//   pnpm pack:modules -- --pkg /a --pkg /b           # multiple packages
//
// NOT yet wired into the default `build` script. Built-in module
// packages (and CRM) still need `module.json` added — see U1.6 in
// docs/blockers/task_22_module_packages_upload_install.md. Once
// every target has a manifest, this can be chained from `build`.
//
// Exit codes:
//   0 — all targeted packages packed successfully
//   1 — at least one package failed or was skipped
//   2 — invalid CLI arguments

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRAMEWORK_ROOT = resolvePath(__dirname, "..");

// ---------------------------------------------------------------------------
// Default module package list. Edit this array to register new
// standalone Module packages. CLI `--pkg` args, if supplied, fully
// override this list.
// ---------------------------------------------------------------------------
const DEFAULT_PACKAGES = [
  "/Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-crm/packages/server",
];

const PACK_BIN = resolvePath(
  FRAMEWORK_ROOT,
  "node_modules/.bin/pack-hebbsmod",
);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const pkgs = [];
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--pkg") {
      const next = argv[i + 1];
      if (!next) throw new Error("--pkg requires a path argument");
      pkgs.push(resolvePath(next));
      i++;
    } else if (a && a.startsWith("--pkg=")) {
      pkgs.push(resolvePath(a.slice("--pkg=".length)));
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { pkgs, help };
}

function printHelp() {
  process.stdout.write(
    [
      "pack-modules — pack every standalone Module package into a .hebbsmod",
      "",
      "Usage:",
      "  pnpm pack:modules",
      "  pnpm pack:modules -- --pkg <path> [--pkg <path> ...]",
      "",
      "When no --pkg flags are passed, the hard-coded DEFAULT_PACKAGES",
      "list in scripts/pack-modules.mjs is used. Pass --pkg to override.",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Filesystem + manifest helpers
// ---------------------------------------------------------------------------

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function shortPath(p) {
  // Show relative-to-framework-root if it's nearby, else absolute.
  const rel = relative(FRAMEWORK_ROOT, p);
  if (!rel.startsWith("..") && !rel.startsWith("/")) return rel;
  // Strip the common "Workspace/research/hebbs-clients/" prefix for readability.
  const idx = p.indexOf("/hebbs-clients/");
  if (idx !== -1) return p.slice(idx + "/hebbs-clients/".length);
  return p;
}

// ---------------------------------------------------------------------------
// Per-package pack
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PackResult
 * @property {"ok" | "skipped" | "failed"} status
 * @property {string} pkgPath
 * @property {string} [id]
 * @property {string} [version]
 * @property {string} [outFile]
 * @property {number} [size]
 * @property {string} [sha256]
 * @property {string} [reason]
 */

/**
 * @param {string} pkgPath
 * @returns {PackResult}
 */
function packOne(pkgPath) {
  if (!isDir(pkgPath)) {
    return {
      status: "failed",
      pkgPath,
      reason: `directory not found: ${pkgPath}`,
    };
  }
  const packageJsonPath = resolvePath(pkgPath, "package.json");
  if (!isFile(packageJsonPath)) {
    return {
      status: "failed",
      pkgPath,
      reason: `missing package.json in ${pkgPath}`,
    };
  }
  const moduleJsonPath = resolvePath(pkgPath, "module.json");
  if (!isFile(moduleJsonPath)) {
    const pkg = readJsonSafe(packageJsonPath) ?? {};
    return {
      status: "skipped",
      pkgPath,
      id: pkg.name,
      reason:
        "module.json missing — see docs/install-flow.md §1.2 and BUILD-A-MODULE.md",
    };
  }

  // Invoke pack-hebbsmod as a subprocess. Inherit stdio so progress
  // lines stream live; we read the manifest afterward to populate
  // the summary row.
  const result = spawnSync(PACK_BIN, ["--pkg", pkgPath], {
    stdio: "inherit",
    cwd: FRAMEWORK_ROOT,
  });

  if (result.error) {
    return {
      status: "failed",
      pkgPath,
      reason: `failed to spawn pack-hebbsmod: ${result.error.message}`,
    };
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return {
      status: "failed",
      pkgPath,
      reason: `pack-hebbsmod exited with code ${result.status}`,
    };
  }
  if (result.signal) {
    return {
      status: "failed",
      pkgPath,
      reason: `pack-hebbsmod terminated by signal ${result.signal}`,
    };
  }

  // Locate the produced artifact via the manifest.
  const manifest = readJsonSafe(moduleJsonPath) ?? {};
  const id = manifest.id;
  const version = manifest.version;
  if (!id || !version) {
    return {
      status: "failed",
      pkgPath,
      reason: "module.json missing id or version after pack",
    };
  }
  const outFile = resolvePath(pkgPath, "dist", `${id}-${version}.hebbsmod`);
  if (!isFile(outFile)) {
    return {
      status: "failed",
      pkgPath,
      id,
      version,
      reason: `expected artifact not found: ${outFile}`,
    };
  }
  const size = statSync(outFile).size;
  // Hash via openssl-compatible Node crypto. Use execFileSync on
  // shasum-style call would be platform-specific; use Node crypto
  // synchronously by reading the file (artifacts are < 2 MB).
  const sha256 = sha256Sync(outFile);
  return { status: "ok", pkgPath, id, version, outFile, size, sha256 };
}

function sha256Sync(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`pack-modules: ${msg}\n\n`);
    printHelp();
    process.exit(2);
  }
  if (args.help) {
    printHelp();
    return;
  }

  if (!isFile(PACK_BIN)) {
    process.stderr.write(
      `pack-modules: pack-hebbsmod binary not found at ${PACK_BIN}\n` +
        `Did you run 'pnpm install' and 'pnpm -r build' first?\n`,
    );
    process.exit(1);
  }

  const targets = args.pkgs.length > 0 ? args.pkgs : DEFAULT_PACKAGES.slice();

  if (targets.length === 0) {
    process.stderr.write(
      "pack-modules: no packages to pack (DEFAULT_PACKAGES empty and no --pkg passed).\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `[pack-modules] packing ${targets.length} package${targets.length === 1 ? "" : "s"}\n\n`,
  );

  /** @type {PackResult[]} */
  const results = [];
  for (const t of targets) {
    process.stdout.write(`── ${t}\n`);
    const r = packOne(t);
    results.push(r);
    process.stdout.write("\n");
  }

  // Summary table.
  process.stdout.write("─── pack-modules summary ───\n");
  for (const r of results) {
    if (r.status === "ok") {
      const out = shortPath(r.outFile);
      const sizeStr = formatBytes(r.size);
      const shaShort = `${r.sha256.slice(0, 12)}…`;
      process.stdout.write(
        `  ok  ${r.id} ${r.version} → ${out} (${sizeStr}, sha256 ${shaShort})\n`,
      );
    } else if (r.status === "skipped") {
      const label = r.id ?? shortPath(r.pkgPath);
      process.stdout.write(`  skip ${label} — ${r.reason}\n`);
    } else {
      const label = r.id ?? shortPath(r.pkgPath);
      process.stdout.write(`  fail ${label} — ${r.reason}\n`);
    }
  }
  process.stdout.write("\n");

  const failures = results.filter((r) => r.status !== "ok");
  if (failures.length > 0) {
    process.stderr.write(
      `pack-modules: ${failures.length} of ${results.length} package${results.length === 1 ? "" : "s"} did not pack successfully.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `pack-modules: ${results.length} package${results.length === 1 ? "" : "s"} packed successfully.\n`,
  );
}

main();
