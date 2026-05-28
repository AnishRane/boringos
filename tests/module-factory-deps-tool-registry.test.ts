// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T3.1d — ModuleFactoryDeps.toolRegistry typed via module-sdk's
// minimal `ToolRegistry` interface; agent's concrete registry
// structurally implements it (adds host-only register/unregister).

import { describe, it, expect, expectTypeOf } from "vitest";
import type { ModuleFactoryDeps, ToolRegistry } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import { createToolRegistry } from "@boringos/agent";

describe("MDK T3.1d — ModuleFactoryDeps.toolRegistry typing", () => {
  it("ModuleFactoryDeps.toolRegistry is typed as ToolRegistry, not unknown", () => {
    expectTypeOf<ModuleFactoryDeps["toolRegistry"]>().toEqualTypeOf<
      ToolRegistry | undefined
    >();
  });

  it("a factory that calls list / get / listByModule compiles without a cast", () => {
    const factory = (deps: ModuleFactoryDeps): string[] => {
      const r = deps.toolRegistry;
      if (!r) return [];
      const all = r.list();
      const peer = r.get("demo.greet");
      const own = r.listByModule("demo");
      return [
        `all=${all.length}`,
        `peer=${peer ? peer.name : "missing"}`,
        `own=${own.length}`,
      ];
    };
    expect(typeof factory).toBe("function");
  });

  it("agent's concrete registry is assignable to the SDK's narrow interface", () => {
    const r = createToolRegistry();
    const narrow: ToolRegistry = r;
    expect(typeof narrow.list).toBe("function");
    expect(typeof narrow.get).toBe("function");
    expect(typeof narrow.listByModule).toBe("function");
  });

  it("lookups + listing round-trip through the narrow surface", () => {
    const r = createToolRegistry();
    r.register("demo", {
      name: "greet",
      description: "say hi",
      inputs: z.object({ name: z.string() }),
      handler: async ({ name }) => ({
        ok: true as const,
        result: { greeting: `hi ${name}` },
      }),
    });

    const narrow: ToolRegistry = r;
    const peer = narrow.get("demo.greet");
    expect(peer?.name).toBe("greet");
    expect(narrow.list()).toHaveLength(1);
    expect(narrow.listByModule("demo")).toHaveLength(1);
    expect(narrow.listByModule("other")).toHaveLength(0);
  });
});
