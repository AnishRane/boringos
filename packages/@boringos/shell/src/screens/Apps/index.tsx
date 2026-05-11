// SPDX-License-Identifier: BUSL-1.1
//
// Modules screen — three tabs: Browse, Installed, Install from URL.
// Renamed from "Apps" to "Modules" in task_21 to match the canonical
// primitive name. The route is `/modules`; `/apps` is kept as a
// backwards-compat redirect (see App.tsx).

import { useState } from "react";

import { ScreenBody, ScreenHeader } from "../_shared.js";
import { Browse } from "./Browse.js";
import { Installed } from "./Installed.js";
import { InstallFromUrl } from "./InstallFromUrl.js";

const TABS = [
  { id: "browse", label: "Browse" },
  { id: "installed", label: "Installed" },
  { id: "install-from-url", label: "Install from URL" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Modules() {
  const [tab, setTab] = useState<TabId>("installed");

  return (
    <>
      <ScreenHeader
        title="Modules"
        subtitle="Browse, install, and manage modules for your tenant"
      />
      <div className="px-8 border-b border-border-subtle">
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                tab === t.id
                  ? "border-accent text-text font-medium"
                  : "border-transparent text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <ScreenBody>
        {tab === "browse" && <Browse />}
        {tab === "installed" && <Installed />}
        {tab === "install-from-url" && <InstallFromUrl />}
      </ScreenBody>
    </>
  );
}
