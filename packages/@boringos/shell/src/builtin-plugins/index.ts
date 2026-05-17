// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Built-in PluginUI contributions for framework-shipped Modules.
//
// Built-in Modules (`framework`, `inbox`, etc.) live server-side and
// have no `.hebbsmod` bundle to upload. Their UI contributions are
// registered here at shell boot via the same `pluginHost.register()`
// path as third-party Modules — no privileged surface. This is what
// puts the framework's existing Home tiles back on the page now that
// Home.tsx is registry-driven.

import type { PluginUI } from "@boringos/ui";

import { pluginHost } from "../plugin-host/registry.js";

import { AgentsOnlineWidget } from "./widgets/AgentsOnlineWidget.js";
import { CostSparklineWidget } from "./widgets/CostSparklineWidget.js";
import { OpenWorkWidget } from "./widgets/OpenWorkWidget.js";
import { OperatingPulseWidget } from "./widgets/OperatingPulseWidget.js";
import { PendingApprovalsWidget } from "./widgets/PendingApprovalsWidget.js";
import { UnreadInboxWidget } from "./widgets/UnreadInboxWidget.js";
import { WatchItemsWidget } from "./widgets/WatchItemsWidget.js";

const frameworkUI: PluginUI = {
  moduleId: "framework",
  displayName: "Framework",
  dashboardWidgets: [
    {
      id: "open-work",
      title: "Open work",
      size: "small",
      slot: "primary",
      element: OpenWorkWidget,
      order: 10,
    },
    {
      id: "agents-online",
      title: "Agents online",
      size: "small",
      slot: "primary",
      element: AgentsOnlineWidget,
      order: 20,
    },
    {
      id: "pending-approvals",
      title: "Pending approvals",
      size: "small",
      slot: "primary",
      element: PendingApprovalsWidget,
      order: 40,
    },
    {
      id: "cost-sparkline",
      title: "Spend last 8 weeks",
      size: "medium",
      slot: "secondary",
      element: CostSparklineWidget,
      order: 10,
    },
    {
      id: "operating-pulse",
      title: "Operating pulse",
      size: "medium",
      slot: "secondary",
      element: OperatingPulseWidget,
      order: 20,
    },
    {
      id: "watch-items",
      title: "Watch items",
      size: "medium",
      slot: "secondary",
      element: WatchItemsWidget,
      order: 30,
    },
  ],
};

const inboxUI: PluginUI = {
  moduleId: "inbox",
  displayName: "Inbox",
  dashboardWidgets: [
    {
      id: "unread-inbox",
      title: "Unread inbox",
      size: "small",
      slot: "primary",
      element: UnreadInboxWidget,
      order: 30,
    },
  ],
};

/**
 * Register every framework-shipped PluginUI contribution. Called once
 * from `main.tsx` before `<App />` mounts.
 */
export function registerBuiltinPlugins(): void {
  pluginHost.register(frameworkUI);
  pluginHost.register(inboxUI);
}
