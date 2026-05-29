// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T6.4 — connector OAuth walkthrough in `hebbs dev`.
//
// A module that declares `dependsOn: [{ capability: "email-send" }]`
// must boot cleanly and surface a concrete next step pointing at the
// connector that provides it (`@boringos/connector-google`). The
// step's `authorizeUrl` is what authors paste into a browser to start
// the OAuth dance against this dev-host instance.
//
// The dance itself terminates against live Google — that bit needs
// Parag's OAuth app credentials and is tracked separately. This file
// verifies wiring, not real OAuth completion.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startDev } from "@boringos/hebbs-cli";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "email-needy-module",
);

describe("MDK T6.4 — connector OAuth walkthrough", () => {
  it("surfaces an OAuth step when the module depends on a capability whose provider is unconnected", async () => {
    if (!existsSync(fixturePath)) {
      console.warn("[hebbs dev auth] skipping — email-needy fixture missing");
      return;
    }
    process.env.HEBBS_DEV_MODULES = "true";

    const handle = await startDev({
      modulePath: fixturePath,
      watch: false,
    });
    try {
      expect(handle.host.moduleId).toBe("email-needy");
      // No connections seeded → exactly one walkthrough step for the
      // capability provider.
      expect(handle.authSteps.length).toBeGreaterThanOrEqual(1);
      const emailStep = handle.authSteps.find(
        (s) => s.capability === "email-send",
      );
      expect(emailStep).toBeDefined();
      if (!emailStep) return;
      expect(emailStep.providerModuleId).toBe("google");
      expect(emailStep.providerName).toBeTruthy();
      expect(emailStep.authorizeUrl).toContain(
        "/api/connectors/oauth/google/authorize",
      );
      expect(emailStep.authorizeUrl).toContain(
        `tenantId=${encodeURIComponent(handle.host.tenantId)}`,
      );
      // Google scopes should reach the URL too.
      expect(emailStep.scopes.length).toBeGreaterThan(0);
      expect(emailStep.authorizeUrl).toContain("scopes=");
      // The reason copy mentions both the capability and the provider.
      expect(emailStep.reason).toMatch(/email-send/);
      expect(emailStep.reason).toMatch(/google|Google/);
    } finally {
      await handle.shutdown();
    }
  }, 120_000);

  it("getAuthSteps() returns an empty list when the module has no dependsOn capabilities", async () => {
    const hello = join(process.cwd(), "tests", "fixtures", "hello-module");
    if (!existsSync(hello)) return;
    process.env.HEBBS_DEV_MODULES = "true";

    const handle = await startDev({
      modulePath: hello,
      watch: false,
    });
    try {
      expect(handle.host.moduleId).toBe("hello");
      expect(handle.authSteps).toEqual([]);
    } finally {
      await handle.shutdown();
    }
  }, 120_000);
});
