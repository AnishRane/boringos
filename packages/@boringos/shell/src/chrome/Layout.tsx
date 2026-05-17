// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shell layout — sidebar + main content area.

import { Outlet } from "react-router-dom";
import { Toaster } from "sonner";
import { Sidebar } from "./Sidebar.js";
import { CommandPalette } from "./CommandPalette.js";
import { ConnectorsHealthIndicator } from "./ConnectorsHealthIndicator.js";
import { useTheme } from "../theme/index.js";

export function Layout() {
  const { effectiveTheme } = useTheme();
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <ConnectorsHealthIndicator />
        <Outlet />
      </main>
      <CommandPalette />
      <Toaster
        position="bottom-right"
        theme={effectiveTheme}
        closeButton
        toastOptions={{
          style: {
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
          },
        }}
      />
    </div>
  );
}
