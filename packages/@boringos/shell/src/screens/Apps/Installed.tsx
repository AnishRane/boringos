// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Modules → Installed tab. Lists every Module the host has registered,
// marks installed/not for the active tenant, and lets admins install
// or uninstall.
//
// task_19 update: switched from raw fetch + local useState to the
// shared @boringos/ui hooks (useClient, useInstalledModulesState,
// useInstallModule, useUninstallModule). This keeps Modules.tsx in
// sync with the same install state the Sidebar reads — previously
// the two code paths could drift (raw fetch missing X-Tenant-Id
// vs. BoringOSClient sending it), making installed modules look
// uninstalled.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useClient,
  useInstalledModulesState,
  useInstallModule,
  useUninstallModule,
  type ModuleInfo,
} from "@boringos/ui";

import { LoadingState, EmptyState } from "../_shared.js";

export function Installed() {
  const client = useClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: modules, isLoading: modulesLoading } = useQuery<ModuleInfo[]>({
    queryKey: ["modules"],
    queryFn: () => client.getModules(),
    staleTime: 60_000,
  });

  const { installed, isLoading: installsLoading } = useInstalledModulesState();
  const installModule = useInstallModule();
  const uninstallModule = useUninstallModule();

  if (modulesLoading || installsLoading) return <LoadingState />;
  if (!modules || modules.length === 0) {
    return (
      <EmptyState
        title="No modules registered"
        description="The host application hasn't registered any modules. Register one via app.module(...) — see BUILD-A-MODULE.md."
      />
    );
  }

  const action = async (moduleId: string, kind: "install" | "uninstall") => {
    setBusy(moduleId);
    setError(null);
    try {
      const mutation = kind === "install" ? installModule : uninstallModule;
      const result = await mutation.mutateAsync(moduleId);
      if (!result.ok && result.hookError) {
        setError(`Hook reported: ${result.hookError}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-muted">
          {modules.length} registered · {installed.size} installed for this tenant
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {modules.map((m) => {
          const isInstalled = installed.has(m.id);
          return (
            <div
              key={m.id}
              className="rounded-md border border-border px-4 py-3 bg-white"
            >
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-text flex items-center gap-2">
                    {m.name}{" "}
                    <span className="text-xs text-muted">v{m.version}</span>
                    {isInstalled && (
                      <span className="text-[10px] uppercase tracking-wide rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5">
                        Installed
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted font-mono">{m.id}</div>
                </div>
                <button
                  type="button"
                  disabled={busy === m.id}
                  onClick={() => action(m.id, isInstalled ? "uninstall" : "install")}
                  className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                    isInstalled
                      ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                      : "bg-accent text-white hover:bg-accent-light"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {busy === m.id
                    ? "Working…"
                    : isInstalled
                      ? "Uninstall"
                      : "Install"}
                </button>
              </div>
              <p className="text-xs text-muted-strong mt-1.5">{m.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {(m.provides ?? []).map((cap) => (
                  <span
                    key={cap}
                    className="rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5"
                  >
                    {cap}
                  </span>
                ))}
                {(m.dependsOn ?? []).map((dep, i) => {
                  const d = dep as unknown as { moduleId?: string; capability?: string; optional?: boolean };
                  const label = d.moduleId
                    ? `→ ${d.moduleId}`
                    : d.capability
                      ? `↘ ${d.capability}`
                      : String(dep);
                  return (
                    <span
                      key={i}
                      className="rounded bg-blue-50 text-blue-700 px-1.5 py-0.5"
                    >
                      {label}
                      {d.optional ? " (optional)" : ""}
                    </span>
                  );
                })}
              </div>
              <div className="mt-2 text-[11px] text-muted">
                {m.tools.length} tool{m.tools.length === 1 ? "" : "s"} ·{" "}
                {m.skills.length} skill{m.skills.length === 1 ? "" : "s"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
