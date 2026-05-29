// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T6.2 — `hebbs dev` hot reload. Two assertions:
//
//   1. `host.reload()` swaps the module in-place — old tool stops
//      being the same closure, new manifest version surfaces, no
//      bounce of the embedded Postgres / server.
//   2. The file watcher armed by `startDev({ watch: "auto" })` fires
//      reload when a source file in the module dir changes.
//
// We clone the hello-module fixture into a tmp dir so the test can
// mutate it without polluting the repo, and so each run starts fresh.

import { afterAll, describe, it, expect } from "vitest";
import { mkdtemp, cp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startDev } from "@boringos/hebbs-cli";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "hello-module",
);

// Clone INSIDE the framework root so Node's module-resolution
// can still find `@boringos/*` + `zod` via the framework's hoisted
// node_modules. tmpdir() would be outside that reach.
const clones: string[] = [];
async function cloneFixture(): Promise<string> {
  const dir = await mkdtemp(
    join(process.cwd(), ".dev-host-reload-fixture-"),
  );
  await cp(fixturePath, dir, { recursive: true });
  clones.push(dir);
  return dir;
}

afterAll(async () => {
  for (const d of clones) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

describe("MDK T6.2 — hebbs dev hot reload", () => {
  it("host.reload() reapplies an edited manifest + tool body without restarting the server", async () => {
    if (!existsSync(fixturePath)) {
      console.warn("[hebbs dev reload] skipping — hello-module fixture missing");
      return;
    }
    process.env.HEBBS_DEV_MODULES = "true";

    const clone = await cloneFixture();
    const handle = await startDev({ modulePath: clone, watch: false });
    try {
      const beforeUrl = handle.host.url;
      const before = await handle.host.dispatch<{
        ok: boolean;
        result: { greeting: string };
      }>("hello.greet", { name: "Grace" });
      expect(before.result.greeting).toBe("Hello, Grace!");
      expect(handle.host.moduleVersion).toBe("0.1.0");

      // Edit: bump version + change tool body.
      const mjsPath = join(clone, "index.mjs");
      const orig = await readFile(mjsPath, "utf8");
      const edited = orig
        .replace(`version: "0.1.0"`, `version: "0.1.1"`)
        .replace("Hello, ${name}!", "Hey there, ${name}!");
      await writeFile(mjsPath, edited);
      const manifestPath = join(clone, "module.json");
      const manifestText = await readFile(manifestPath, "utf8");
      await writeFile(
        manifestPath,
        manifestText.replace(`"0.1.0"`, `"0.1.1"`),
      );

      const result = await handle.host.reload();
      expect(result.moduleId).toBe("hello");
      expect(result.moduleVersion).toBe("0.1.1");
      expect(result.toolsAdded).toBeGreaterThan(0);
      expect(result.durationMs).toBeLessThan(5_000);
      expect(handle.host.moduleVersion).toBe("0.1.1");

      // Same server, same URL — no bounce.
      expect(handle.host.url).toBe(beforeUrl);

      const after = await handle.host.dispatch<{
        ok: boolean;
        result: { greeting: string };
      }>("hello.greet", { name: "Grace" });
      expect(after.result.greeting).toBe("Hey there, Grace!");
    } finally {
      await handle.shutdown();
    }
  }, 120_000);

  it("watch:'auto' wires fs.watch and onReload fires when a watched file changes", async () => {
    if (!existsSync(fixturePath)) return;
    process.env.HEBBS_DEV_MODULES = "true";

    const clone = await cloneFixture();

    let reloadCount = 0;
    let lastVersion = "";
    let reloadResolve: (() => void) | null = null;
    const firstReload = new Promise<void>((res) => {
      reloadResolve = res;
    });

    const handle = await startDev({
      modulePath: clone,
      watch: "auto",
      watchDebounceMs: 50,
      onReload: (r) => {
        reloadCount += 1;
        lastVersion = r.moduleVersion;
        if (reloadResolve) {
          const r2 = reloadResolve;
          reloadResolve = null;
          r2();
        }
      },
    });

    try {
      expect(handle.watching).toBe(true);

      // Edit so the watcher fires.
      const mjsPath = join(clone, "index.mjs");
      const orig = await readFile(mjsPath, "utf8");
      const edited = orig.replace(`version: "0.1.0"`, `version: "0.1.2"`);
      const manifestPath = join(clone, "module.json");
      const manifestText = await readFile(manifestPath, "utf8");

      // Write both edits — debounce will fold the events.
      await Promise.all([
        writeFile(mjsPath, edited),
        writeFile(
          manifestPath,
          manifestText.replace(`"0.1.0"`, `"0.1.2"`),
        ),
      ]);

      // Wait up to 30s for the watcher → debounce → reload cycle.
      await Promise.race([
        firstReload,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("watcher reload never fired")), 30_000),
        ),
      ]);

      expect(reloadCount).toBeGreaterThanOrEqual(1);
      expect(lastVersion).toBe("0.1.2");
    } finally {
      await handle.shutdown();
    }
  }, 120_000);
});
