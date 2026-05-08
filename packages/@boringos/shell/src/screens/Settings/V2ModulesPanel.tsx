// SPDX-License-Identifier: BUSL-1.1
//
// Settings → v2 Modules panel. Lists every Module the host has
// registered, marks installed/not for the active tenant, and
// gives admins install/uninstall buttons.
//
// Data:
//  - GET  /api/admin/v2/modules           (host-registered)
//  - GET  /api/admin/v2/installs          (per-tenant install state)
//  - POST /api/admin/v2/modules/:id/install
//  - POST /api/admin/v2/modules/:id/uninstall

import { useEffect, useState, useCallback } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { LoadingState, EmptyState } from "../_shared.js";

type ModuleRow = {
  id: string;
  name: string;
  version: string;
  description: string;
  provides: string[];
  dependsOn: Array<{ moduleId?: string; capability?: string; optional?: boolean }>;
  tools: Array<{ name: string; description: string }>;
  skills: Array<{ id: string; source: string; priority?: number }>;
};

type InstallRow = {
  moduleId: string;
  version: string;
  installedAt: string;
};

function authHeaders(token: string | null, tenantId: string | undefined) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

export function V2ModulesPanel() {
  const { user, token } = useAuth();
  const [modules, setModules] = useState<ModuleRow[] | null>(null);
  const [installs, setInstalls] = useState<InstallRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.tenantId) return;
    setError(null);
    try {
      const [modulesRes, installsRes] = await Promise.all([
        fetch("/api/admin/v2/modules", { headers: authHeaders(token, user.tenantId) }),
        fetch("/api/admin/v2/installs", { headers: authHeaders(token, user.tenantId) }),
      ]);
      if (modulesRes.status === 404) {
        // v2 not mounted on this host — no modules registered.
        setModules([]);
        setInstalls([]);
        return;
      }
      if (!modulesRes.ok) throw new Error(`modules: ${modulesRes.status}`);
      if (!installsRes.ok) throw new Error(`installs: ${installsRes.status}`);
      const m = (await modulesRes.json()) as { modules: ModuleRow[] };
      const i = (await installsRes.json()) as { installs: InstallRow[] };
      setModules(m.modules);
      setInstalls(i.installs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [token, user?.tenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!user?.role || user.role !== "admin") {
    return (
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
        <div className="font-medium">Admin access required</div>
        <div className="text-xs mt-1">Only admins can manage modules.</div>
      </div>
    );
  }

  if (modules === null) return <LoadingState />;
  if (modules.length === 0) {
    return (
      <EmptyState
        title="No v2 modules registered"
        description="The host application hasn't registered any v2 modules. v2 is opt-in via app.module(...) — see BUILD-A-MODULE.md."
      />
    );
  }

  const installedIds = new Set(installs?.map((r) => r.moduleId) ?? []);

  const action = async (moduleId: string, kind: "install" | "uninstall") => {
    if (!user.tenantId) return;
    setBusy(moduleId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/v2/modules/${moduleId}/${kind}`, {
        method: "POST",
        headers: authHeaders(token, user.tenantId),
        body: "{}",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${kind} returned ${res.status}`);
      }
      const body = (await res.json()) as { ok: boolean; hookError?: string };
      if (body.hookError) {
        setError(`Hook reported: ${body.hookError}`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-slate-900">Modules</h2>
        <span className="text-xs text-slate-500">
          {modules.length} registered · {installedIds.size} installed for this tenant
        </span>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {modules.map((m) => {
          const installed = installedIds.has(m.id);
          return (
            <div
              key={m.id}
              className="rounded-md border border-slate-200 px-4 py-3 bg-white"
            >
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    {m.name}{" "}
                    <span className="text-xs text-slate-400">v{m.version}</span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono">{m.id}</div>
                </div>
                <button
                  type="button"
                  disabled={busy === m.id}
                  onClick={() => action(m.id, installed ? "uninstall" : "install")}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                    installed
                      ? "border border-slate-300 text-slate-700 hover:bg-slate-50"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  } disabled:opacity-50`}
                >
                  {busy === m.id
                    ? "..."
                    : installed
                      ? "Uninstall"
                      : "Install"}
                </button>
              </div>
              <p className="text-xs text-slate-600 mt-1.5">{m.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {m.provides.map((cap) => (
                  <span
                    key={cap}
                    className="rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5"
                  >
                    {cap}
                  </span>
                ))}
                {m.dependsOn.map((d, i) => {
                  const label = d.moduleId
                    ? `→ ${d.moduleId}`
                    : `→ ${d.capability}${d.optional ? "?" : ""}`;
                  return (
                    <span
                      key={`${i}-${label}`}
                      className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5"
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                <div>
                  <span className="font-medium text-slate-700">{m.tools.length}</span>{" "}
                  tools
                </div>
                <div>
                  <span className="font-medium text-slate-700">{m.skills.length}</span>{" "}
                  skills
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
