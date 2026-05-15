/**
 * task_26 — DashboardWidget contract + plugin-host registry.
 *
 * Asserts that:
 *  - PluginUI.dashboardWidgets contributions are aggregated by
 *    pluginHost.dashboardWidgets and carry moduleId
 *  - the getter sorts primary above secondary, then by order, then
 *    by moduleId
 *  - unregister() drops the widgets immediately and notifies subscribers
 *  - re-registering the same moduleId replaces (not duplicates) widgets
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { pluginHost } from "@boringos/shell/plugin-host/registry.js";
import type { PluginUI } from "@boringos/ui";

function MockWidget() {
  return null;
}

function makeUI(
  id: string,
  widgets: PluginUI["dashboardWidgets"],
  displayName?: string,
): PluginUI {
  return {
    moduleId: id,
    displayName: displayName ?? id,
    dashboardWidgets: widgets,
  };
}

describe("task_26 — pluginHost.dashboardWidgets", () => {
  beforeEach(() => {
    // Ensure a clean registry between tests.
    for (const m of [...pluginHost.modules]) {
      pluginHost.unregister(m.moduleId);
    }
  });

  afterEach(() => {
    for (const m of [...pluginHost.modules]) {
      pluginHost.unregister(m.moduleId);
    }
  });

  it("aggregates widgets from every registered module and attaches moduleId", () => {
    pluginHost.register(
      makeUI("framework", [
        {
          id: "open-work",
          title: "Open work",
          size: "small",
          slot: "primary",
          element: MockWidget,
          order: 10,
        },
      ]),
    );
    pluginHost.register(
      makeUI("crm", [
        {
          id: "deals-closing",
          title: "Closing this week",
          size: "medium",
          slot: "secondary",
          element: MockWidget,
          order: 100,
        },
      ]),
    );

    const widgets = pluginHost.dashboardWidgets;
    expect(widgets.map((w) => `${w.moduleId}:${w.id}`)).toEqual([
      "framework:open-work",
      "crm:deals-closing",
    ]);
    expect(widgets[0].size).toBe("small");
    expect(widgets[1].slot).toBe("secondary");
  });

  it("sorts primary above secondary, then by order, then by moduleId", () => {
    pluginHost.register(
      makeUI("crm", [
        {
          id: "alpha",
          title: "A",
          size: "small",
          slot: "secondary",
          element: MockWidget,
          order: 50,
        },
        {
          id: "beta",
          title: "B",
          size: "small",
          slot: "primary",
          element: MockWidget,
          order: 100,
        },
      ]),
    );
    pluginHost.register(
      makeUI("framework", [
        {
          id: "gamma",
          title: "G",
          size: "small",
          slot: "primary",
          element: MockWidget,
          order: 50,
        },
        {
          id: "delta",
          title: "D",
          size: "small",
          slot: "secondary",
          element: MockWidget,
          order: 50,
        },
      ]),
    );

    const widgets = pluginHost.dashboardWidgets;
    // primary first (gamma order 50 < beta order 100), then secondary
    // (framework:delta and crm:alpha share order 50 — moduleId
    // alphabetical breaks the tie → crm:alpha before framework:delta).
    expect(widgets.map((w) => `${w.moduleId}:${w.id}`)).toEqual([
      "framework:gamma",
      "crm:beta",
      "crm:alpha",
      "framework:delta",
    ]);
  });

  it("unregister drops widgets and bumps the snapshot version", () => {
    const startSnapshot = pluginHost.getSnapshot();
    pluginHost.register(
      makeUI("crm", [
        {
          id: "deals-closing",
          title: "C",
          size: "medium",
          slot: "secondary",
          element: MockWidget,
        },
      ]),
    );
    expect(pluginHost.dashboardWidgets).toHaveLength(1);
    expect(pluginHost.getSnapshot()).toBeGreaterThan(startSnapshot);

    const afterRegister = pluginHost.getSnapshot();
    pluginHost.unregister("crm");
    expect(pluginHost.dashboardWidgets).toHaveLength(0);
    expect(pluginHost.getSnapshot()).toBeGreaterThan(afterRegister);
  });

  it("re-registering the same moduleId replaces widgets (no duplicates)", () => {
    pluginHost.register(
      makeUI("crm", [
        {
          id: "deals-closing",
          title: "Original",
          size: "small",
          slot: "secondary",
          element: MockWidget,
        },
      ]),
    );
    pluginHost.register(
      makeUI("crm", [
        {
          id: "pipeline-by-stage",
          title: "Replacement",
          size: "medium",
          slot: "secondary",
          element: MockWidget,
        },
      ]),
    );

    const widgets = pluginHost.dashboardWidgets;
    expect(widgets).toHaveLength(1);
    expect(widgets[0].id).toBe("pipeline-by-stage");
  });

  it("invokes subscribers on register and unregister", () => {
    let calls = 0;
    const unsub = pluginHost.subscribe(() => {
      calls += 1;
    });
    pluginHost.register(
      makeUI("crm", [
        {
          id: "w1",
          title: "W",
          size: "small",
          slot: "primary",
          element: MockWidget,
        },
      ]),
    );
    pluginHost.unregister("crm");
    unsub();
    expect(calls).toBe(2);
  });
});
