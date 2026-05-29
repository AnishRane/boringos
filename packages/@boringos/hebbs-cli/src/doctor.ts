// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `hebbs doctor` — health-checks a module package for SDK compat,
// deprecated API usage, and pin freshness.
//
// MDK T7.4. Codemod-driven auto-fixes ride on top in T7.5.

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";

export interface DoctorOptions {
  /** Path to the module package root (contains `package.json`). */
  modulePath: string;
  /** Override the "current SDK minor" the version-check compares
   *  against. Defaults to the version baked into hebbs-cli at build. */
  currentSdkVersion?: string;
}

export interface DoctorFinding {
  severity: "info" | "warn" | "error";
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface DoctorReport {
  modulePath: string;
  findings: DoctorFinding[];
  ok: boolean;
}

// The minimum @boringos/module-sdk version a module should consume
// to get the current MDK surface (Lifecycle.seed, inboxSource, etc.).
// Bumped per-release; the CLI bundle treats it as a floor.
const MIN_SDK_VERSION = "0.11.0"; // MDK T7.3

/**
 * Run all doctor checks against `modulePath` and return a structured
 * report. The CLI wraps this with stdout formatting; tests assert
 * on the report directly.
 */
export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const minSdk = opts.currentSdkVersion ?? MIN_SDK_VERSION;

  // ── 1. Package.json sanity ───────────────────────────────
  const pkgPath = join(opts.modulePath, "package.json");
  if (!existsSync(pkgPath)) {
    return {
      modulePath: opts.modulePath,
      findings: [
        {
          severity: "error",
          code: "no-package-json",
          message: `package.json not found at ${pkgPath}`,
        },
      ],
      ok: false,
    };
  }
  const pkgRaw = await readFile(pkgPath, "utf8");
  let pkg: {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(pkgRaw);
  } catch (err) {
    return {
      modulePath: opts.modulePath,
      findings: [
        {
          severity: "error",
          code: "invalid-package-json",
          message: `package.json is not valid JSON: ${(err as Error).message}`,
        },
      ],
      ok: false,
    };
  }

  // ── 2. SDK pin floor ────────────────────────────────────
  const sdkPin = pkg.dependencies?.["@boringos/module-sdk"];
  if (!sdkPin) {
    findings.push({
      severity: "error",
      code: "missing-module-sdk",
      message:
        '@boringos/module-sdk is not listed in `dependencies`. Modules must declare the SDK they target.',
    });
  } else {
    const stripped = sdkPin.replace(/^[\^~]/, "");
    if (compareSemver(stripped, minSdk) < 0) {
      findings.push({
        severity: "warn",
        code: "stale-module-sdk",
        message: `@boringos/module-sdk pinned at ${sdkPin}; current MDK surface is ${minSdk}. Bump to unlock Lifecycle.seed / inboxSource / __seed_meta.`,
      });
    }
  }

  // ── 3. Disallowed `link:` / `workspace:` deps ─────────────
  for (const block of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    for (const [name, version] of Object.entries(pkg[block] ?? {})) {
      if (version.startsWith("link:") || version.startsWith("workspace:") || version.startsWith("file:")) {
        findings.push({
          severity: "error",
          code: "non-versioned-dep",
          message: `${name}@${version} uses a non-versioned spec in ${block}. Use a semver range so the published .hebbsmod resolves on a clean machine.`,
        });
      }
    }
  }

  // ── 4. Source scan: deprecated `ModuleUI` import ─────────
  const srcDir = join(opts.modulePath, "src");
  if (existsSync(srcDir)) {
    for (const f of await listSourceFiles(srcDir)) {
      const text = await readFile(f, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Crude but effective: import { … ModuleUI … } from "@boringos/module-sdk"
        if (
          /from\s+["']@boringos\/module-sdk["']/.test(line) &&
          /\bModuleUI\b/.test(line)
        ) {
          findings.push({
            severity: "warn",
            code: "deprecated-module-ui",
            message:
              "ModuleUI is deprecated since MDK T3.2 — migrate to PluginUI (separate web bundle, declared in module.json's `ui.entry`). See BUILD-A-MODULE.md.",
            file: f,
            line: i + 1,
          });
        }
      }
    }
  }

  const ok = !findings.some((f) => f.severity === "error");
  return { modulePath: opts.modulePath, findings, ok };
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      out.push(...(await listSourceFiles(full)));
      continue;
    }
    const ext = extname(name);
    if ([".ts", ".tsx", ".mts", ".js", ".mjs"].includes(ext)) out.push(full);
  }
  return out;
}

/** Naive semver compare — returns -1 / 0 / 1. Strips pre-release suffix. */
function compareSemver(a: string, b: string): number {
  const norm = (v: string) => v.replace(/[-+].*$/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const [aMaj = 0, aMin = 0, aPat = 0] = norm(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = norm(b);
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  if (aPat !== bPat) return aPat < bPat ? -1 : 1;
  return 0;
}
