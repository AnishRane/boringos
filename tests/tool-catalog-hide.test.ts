// task_24 — verify memory.* tools are hidden from the agent's
// system prompt while remaining registered + dispatchable.
//
// Agents have filesystem access to the same on-disk endpoint via
// the mount, so exposing the HTTP tool description tempts them
// away from the faster, more composable path. Tools stay in the
// registry for non-agent callers (UI, scripts, webhooks).

import { describe, it, expect } from "vitest";
import { z } from "@boringos/module-sdk";
import {
  createToolRegistry,
  createToolCatalogProvider,
} from "@boringos/agent";
import type { ContextBuildEvent } from "@boringos/agent";

describe("tool-catalog provider — agent prompt hide list", () => {
  it("registered memory.* tools are absent from the agent catalog output", async () => {
    const registry = createToolRegistry();
    registry.register("memory", {
      name: "remember",
      description: "Store a fact for cross-run recall",
      inputs: z.object({}),
      async handler() {
        return { ok: true, result: {} };
      },
    });
    registry.register("memory", {
      name: "recall",
      description: "Search across memory",
      inputs: z.object({}),
      async handler() {
        return { ok: true, result: {} };
      },
    });
    registry.register("framework", {
      name: "tasks.list",
      description: "List tasks",
      inputs: z.object({}),
      async handler() {
        return { ok: true, result: {} };
      },
    });

    const provider = createToolCatalogProvider({ registry });
    const out = await provider.provide({} as ContextBuildEvent);

    // memory.* must not appear in the catalog text the agent reads.
    expect(out).not.toMatch(/memory\.remember/);
    expect(out).not.toMatch(/memory\.recall/);
    // Non-hidden tools still appear normally.
    expect(out).toMatch(/framework\.tasks\.list/);
  });

  it("registry still returns memory.* tools for non-agent callers", () => {
    const registry = createToolRegistry();
    registry.register("memory", {
      name: "remember",
      description: "Store a fact",
      inputs: z.object({}),
      async handler() {
        return { ok: true, result: {} };
      },
    });
    // The registry is the source of truth for dispatch. Even though
    // the catalog provider hides these, registry.get must still
    // return them so the HTTP tool dispatcher works for the UI.
    expect(registry.get("memory.remember")).toBeDefined();
  });
});
