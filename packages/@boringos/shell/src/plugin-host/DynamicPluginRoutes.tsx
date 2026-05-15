// SPDX-License-Identifier: GPL-3.0-or-later
//
// Emits one <Route> per plugin nav item, gated by
// <RequireInstall moduleId={...}>. Mount inside the auth-gated
// <Layout /> in App.tsx.

import { Suspense } from "react";
import { Route } from "react-router-dom";
import { RequireInstall } from "@boringos/ui";
import { pluginHost } from "./registry.js";

/**
 * Returns an array of <Route> children. Use as `{...DynamicPluginRoutes()}`
 * inside a <Routes> block, since react-router-dom needs Route children
 * to be direct descendants and not wrapped in a fragment-rendering
 * component.
 */
export function DynamicPluginRoutes() {
  return pluginHost.navItems.map((n) => {
    const Element = n.element as React.ComponentType;
    return (
      <Route
        key={`${n.moduleId}.${n.id}`}
        path={n.path.replace(/^\//, "")}
        element={
          <RequireInstall moduleId={n.moduleId}>
            <Suspense fallback={<div className="p-6 text-sm text-muted">Loading {n.label}…</div>}>
              <Element />
            </Suspense>
          </RequireInstall>
        }
      />
    );
  });
}
