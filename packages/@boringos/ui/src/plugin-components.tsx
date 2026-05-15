// SPDX-License-Identifier: GPL-3.0-or-later
//
// Small kernel components the plugin runtime needs:
//
//   <RequireInstall moduleId="crm">{children}</RequireInstall>
//     Gates a route on the current tenant having the module installed.
//     If not installed, redirects to /modules?install=<moduleId>.

import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useInstalledModulesState } from "./plugin-hooks.js";

export interface RequireInstallProps {
  moduleId: string;
  children: ReactNode;
  /** Fallback path. Defaults to /modules?install=<moduleId>. */
  redirectTo?: string;
}

export function RequireInstall({ moduleId, children, redirectTo }: RequireInstallProps) {
  const { installed, isLoading } = useInstalledModulesState();
  // Don't redirect while the install state is still being fetched —
  // the initial render before the query resolves would always look
  // "not installed" and bounce a refresh on a deep link.
  if (isLoading) {
    return <div className="p-6 text-sm text-muted">Checking access…</div>;
  }
  if (!installed.has(moduleId)) {
    return <Navigate to={redirectTo ?? `/modules?install=${moduleId}`} replace />;
  }
  return <>{children}</>;
}
