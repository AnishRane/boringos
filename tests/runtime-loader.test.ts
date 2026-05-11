/**
 * task_22 U4.5 — runtime plugin loader (node-side test for the
 * fallback path).
 *
 * Verifies that `loadRuntimePlugin(id)` returns a structured error
 * (loaded=false + error) instead of throwing when the dynamic
 * import fails — e.g. because `/modules/<id>/ui/index.mjs` can't
 * be resolved by Node (only the browser proxies this path to the
 * framework). The point of this test is to guarantee the shell
 * never crashes on an unreachable module URL.
 *
 * Also verifies:
 *   - `unloadRuntimePlugin` is a no-op when the id isn't registered.
 *   - `syncRuntimePlugins` returns one result per input id and
 *     never rejects.
 */
import { describe, it, expect } from "vitest";

// The shell alias resolves to packages/@boringos/shell/src — see
// vitest.config.ts. `./plugin-host/runtime-loader.ts` is the
// runtime-loader entry.
import {
  loadRuntimePlugin,
  syncRuntimePlugins,
  unloadRuntimePlugin,
  pluginHost,
} from "@boringos/shell/plugin-host/index.js";

describe("task_22 U4.5 — runtime-loader fallback", () => {
  it("returns { loaded: false, error } when the import fails", async () => {
    const result = await loadRuntimePlugin("nonexistent-test-module");
    expect(result.moduleId).toBe("nonexistent-test-module");
    expect(result.loaded).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(pluginHost.modules.find((m) => m.moduleId === "nonexistent-test-module")).toBeUndefined();
  });

  it("syncRuntimePlugins never rejects, returns one result per id", async () => {
    const results = await syncRuntimePlugins(
      new Set(["does-not-exist-a", "does-not-exist-b"]),
    );
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.loaded).toBe(false);
      expect(typeof r.error).toBe("string");
    }
  });

  it("unloadRuntimePlugin is a no-op when nothing is registered", () => {
    // No throw. No registry entry to begin with — verify state
    // is unchanged.
    const before = pluginHost.modules.length;
    unloadRuntimePlugin("never-registered");
    expect(pluginHost.modules.length).toBe(before);
  });

  it("register + unregister fires subscribers and bumps snapshot", () => {
    let fires = 0;
    const unsubscribe = pluginHost.subscribe(() => {
      fires += 1;
    });
    const before = pluginHost.getSnapshot();
    pluginHost.register({ moduleId: "subscriber-test", navItems: [] });
    expect(pluginHost.getSnapshot()).toBeGreaterThan(before);
    expect(fires).toBe(1);
    pluginHost.unregister("subscriber-test");
    expect(fires).toBe(2);
    unsubscribe();
    pluginHost.register({ moduleId: "subscriber-test-2", navItems: [] });
    expect(fires).toBe(2); // unsubscribed, no more fires
    pluginHost.unregister("subscriber-test-2");
  });
});
