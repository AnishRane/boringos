// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T7.4 — `hebbs doctor` health-check.
//
// Exercises the three core lints:
//   1. Missing `@boringos/module-sdk` → error.
//   2. Old SDK pin (below the floor) → warn.
//   3. Deprecated `ModuleUI` import in source → warn.
// And a happy-path check that a fresh scaffold passes.

import { afterAll, describe, it, expect } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "@boringos/hebbs-cli";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

async function makeModule(opts: {
  packageJson: Record<string, unknown>;
  srcFiles?: Record<string, string>;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hebbs-doctor-"));
  dirs.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify(opts.packageJson, null, 2));
  if (opts.srcFiles) {
    await mkdir(join(dir, "src"), { recursive: true });
    for (const [name, body] of Object.entries(opts.srcFiles)) {
      await writeFile(join(dir, "src", name), body);
    }
  }
  return dir;
}

describe("MDK T7.4 — hebbs doctor", () => {
  it("flags a module missing @boringos/module-sdk as an error", async () => {
    const mod = await makeModule({
      packageJson: { name: "bare-mod", version: "0.1.0" },
    });
    const report = await runDoctor({ modulePath: mod });
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "missing-module-sdk")).toBe(true);
  });

  it("warns on a stale @boringos/module-sdk pin", async () => {
    const mod = await makeModule({
      packageJson: {
        name: "stale-mod",
        version: "0.1.0",
        dependencies: { "@boringos/module-sdk": "^0.1.0" },
      },
    });
    const report = await runDoctor({
      modulePath: mod,
      currentSdkVersion: "0.11.0",
    });
    expect(report.findings.some((f) => f.code === "stale-module-sdk")).toBe(true);
  });

  it("warns when source imports deprecated ModuleUI", async () => {
    const mod = await makeModule({
      packageJson: {
        name: "ui-mod",
        version: "0.1.0",
        dependencies: { "@boringos/module-sdk": "^0.11.0" },
      },
      srcFiles: {
        "module.ts": `import { ModuleUI } from "@boringos/module-sdk";\nexport const ui: ModuleUI = { screens: [] };\n`,
      },
    });
    const report = await runDoctor({
      modulePath: mod,
      currentSdkVersion: "0.11.0",
    });
    const dep = report.findings.find((f) => f.code === "deprecated-module-ui");
    expect(dep).toBeDefined();
    expect(dep?.line).toBe(1);
  });

  it("flags link:/workspace: deps as errors", async () => {
    const mod = await makeModule({
      packageJson: {
        name: "linked",
        version: "0.1.0",
        dependencies: {
          "@boringos/module-sdk": "^0.11.0",
          "@boringos-crm/shared": "link:../shared",
        },
      },
    });
    const report = await runDoctor({ modulePath: mod, currentSdkVersion: "0.11.0" });
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "non-versioned-dep")).toBe(true);
  });

  it("returns ok on a clean module", async () => {
    const mod = await makeModule({
      packageJson: {
        name: "clean",
        version: "0.1.0",
        dependencies: { "@boringos/module-sdk": "^0.11.0" },
      },
      srcFiles: {
        "module.ts": `import { z } from "@boringos/module-sdk";\nexport const inputs = z.object({});\n`,
      },
    });
    const report = await runDoctor({
      modulePath: mod,
      currentSdkVersion: "0.11.0",
    });
    expect(report.ok).toBe(true);
    expect(report.findings.length).toBe(0);
  });
});
