// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T6.1 — `hebbs dev` keeps the dev-host alive. Drives
// `startDev()` directly (the same API the CLI invokes) and verifies
// the host stays up + dispatch works against it before tearing
// down. Hot-reload (T6.2) gets its own test.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startDev } from "@boringos/hebbs-cli";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "hello-module",
);

describe("MDK T6.1 — hebbs dev", () => {
  it("returns a live DevHost handle until shutdown() is called", async () => {
    if (!existsSync(fixturePath)) {
      console.warn("[hebbs dev] skipping — hello-module fixture missing");
      return;
    }
    process.env.HEBBS_DEV_MODULES = "true";

    const handle = await startDev({ modulePath: fixturePath });
    try {
      expect(handle.host.moduleId).toBe("hello");
      expect(handle.host.url).toMatch(/^http:\/\//);
      // Host is alive — dispatch a tool to prove it.
      const r = await handle.host.dispatch<{
        ok: boolean;
        result: { greeting: string };
      }>("hello.greet", { name: "Grace" });
      expect(r.ok).toBe(true);
      expect(r.result.greeting).toBe("Hello, Grace!");
    } finally {
      await handle.shutdown();
    }
  }, 120_000);

  it("startDev with --tool/--inputs runs the smoke before holding the host open", async () => {
    if (!existsSync(fixturePath)) return;
    process.env.HEBBS_DEV_MODULES = "true";

    const handle = await startDev({
      modulePath: fixturePath,
      smokeToolName: "hello.greet",
      smokeToolInputs: { name: "Linus" },
    });
    try {
      // Smoke already ran during startDev; host should still be usable.
      const r = await handle.host.dispatch<{
        ok: boolean;
        result: { greeting: string };
      }>("hello.greet", { name: "Ada" });
      expect(r.result.greeting).toBe("Hello, Ada!");
    } finally {
      await handle.shutdown();
    }
  }, 120_000);
});
