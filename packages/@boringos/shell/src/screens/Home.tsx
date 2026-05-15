// SPDX-License-Identifier: GPL-3.0-or-later
//
// Home — Executive Brief dashboard.
//
// The page is a registry, not a layout (task_26). Every tile is a
// widget contributed by a Module via `PluginUI.dashboardWidgets`.
// The framework's own tiles (open work, agents online, unread inbox,
// pending approvals, cost sparkline, operating pulse, watch items)
// are contributed by the built-in `framework` and `inbox` modules
// via `registerBuiltinPlugins()`. Third-party Modules add their own
// tiles by exporting `dashboardWidgets` in their `PluginUI`.

import { useAuth } from "../auth/AuthProvider.js";
import { DashboardWidgetGrid } from "../components/index.js";
import { useDashboardWidgets } from "../plugin-host/index.js";
import { ScreenBody, ScreenHeader } from "./_shared.js";

export function Home() {
  const { user } = useAuth();
  const widgets = useDashboardWidgets();

  return (
    <>
      <ScreenHeader
        title={`Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        subtitle="Executive brief"
      />
      <ScreenBody>
        <DashboardWidgetGrid widgets={widgets} />
      </ScreenBody>
    </>
  );
}
