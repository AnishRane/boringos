// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T3.2 — `PluginUI` is the canonical UI contract re-exported
// from `@boringos/module-sdk`. Module authors get all 7 slot types
// (nav, dashboard widgets, entity panels, entity actions, settings
// panels, copilot tools, inbox filters) with a single import.

import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  PluginUI,
  NavItem,
  EntityPanel,
  EntityAction,
  SettingsPanel,
  CopilotTool,
  InboxFilter,
  DashboardWidget,
  DashboardWidgetSize,
  DashboardWidgetSlot,
} from "@boringos/module-sdk";
import type { PluginUI as PluginUIFromUi } from "@boringos/ui";

describe("MDK T3.2 — module-sdk re-exports PluginUI", () => {
  it("PluginUI from module-sdk is identical to PluginUI from @boringos/ui", () => {
    expectTypeOf<PluginUI>().toEqualTypeOf<PluginUIFromUi>();
  });

  it("the 7 slot types are reachable from module-sdk", () => {
    // Pure compile-time existence check — if the re-export drops
    // any of these, the file fails to typecheck.
    type Reachable =
      | NavItem
      | EntityPanel
      | EntityAction
      | SettingsPanel
      | CopilotTool
      | InboxFilter
      | DashboardWidget;
    expectTypeOf<Reachable>().not.toBeNever();
  });

  it("DashboardWidgetSize and DashboardWidgetSlot are reachable", () => {
    expectTypeOf<DashboardWidgetSize>().toEqualTypeOf<
      "small" | "medium" | "large"
    >();
    expectTypeOf<DashboardWidgetSlot>().toEqualTypeOf<"primary" | "secondary">();
  });

  it("PluginUI's required moduleId + 7 optional slot fields are shape-stable", () => {
    // A concrete value that satisfies the contract. If any slot
    // type drifts breaking-ly, this construction fails to compile.
    const ui: PluginUI = {
      moduleId: "demo",
      displayName: "Demo Module",
      navItems: [],
      dashboardWidgets: [],
      entityPanels: [],
      entityActions: [],
      settingsPanels: [],
      copilotTools: [],
      inboxFilters: [],
    };
    expect(ui.moduleId).toBe("demo");
  });
});
