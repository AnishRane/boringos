// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T3.1b — ModuleFactoryDeps.realtimeBus typed via module-sdk's
// minimal `RealtimeBus` interface; core's concrete bus implements
// the SDK surface structurally.

import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  ModuleFactoryDeps,
  RealtimeBus,
  RealtimeEvent,
} from "@boringos/module-sdk";
import { createRealtimeBus } from "@boringos/core";

describe("MDK T3.1b — ModuleFactoryDeps.realtimeBus typing", () => {
  it("ModuleFactoryDeps.realtimeBus is typed as RealtimeBus, not unknown", () => {
    expectTypeOf<ModuleFactoryDeps["realtimeBus"]>().toEqualTypeOf<
      RealtimeBus | undefined
    >();
  });

  it("a factory that calls realtimeBus.publish compiles without a cast", () => {
    const factory = (deps: ModuleFactoryDeps): void => {
      const bus = deps.realtimeBus;
      if (!bus) return;
      bus.publish({
        type: "module:installed",
        tenantId: "00000000-0000-0000-0000-000000000000",
        data: { moduleId: "demo" },
        timestamp: new Date().toISOString(),
      });
    };
    expect(typeof factory).toBe("function");
  });

  it("core's concrete realtime bus is assignable to the SDK's narrow interface", () => {
    const bus = createRealtimeBus();
    const narrow: RealtimeBus = bus;
    expect(narrow.publish).toBe(bus.publish);
  });

  it("publishing a real event flows through end-to-end", () => {
    const bus = createRealtimeBus();
    const tenantId = "11111111-1111-1111-1111-111111111111";
    const received: RealtimeEvent[] = [];
    const unsub = bus.subscribe(tenantId, (e) => {
      received.push(e);
    });
    bus.publish({
      type: "run:completed",
      tenantId,
      data: { runId: "r-1" },
      timestamp: new Date().toISOString(),
    });
    unsub();
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("run:completed");
  });
});
