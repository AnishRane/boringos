// SPDX-License-Identifier: BUSL-1.1
//
// Settings → Agents (Operational) panel.
// Global pause toggle + per-agent controls: pause/resume, change model, view runs.

import { useState } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { useAgents, useRuntimes, useSettings, useCosts } from "@boringos/ui";
import { LoadingState, EmptyState } from "../_shared.js";

export function AgentsPanel() {
  const { user } = useAuth();
  const { agents, isLoading: agentsLoading, updateAgent } = useAgents();
  const { runtimes } = useRuntimes();
  const { settings, updateSettings } = useSettings();
  const { costs } = useCosts();
  const [error, setError] = useState<string | null>(null);

  if (!user?.role || user.role !== "admin") {
    return (
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
        <div className="font-medium">Admin access required</div>
        <div className="text-xs mt-1">Only admins can manage agents.</div>
      </div>
    );
  }

  if (agentsLoading) return <LoadingState />;
  if (!agents || agents.length === 0) {
    return <EmptyState title="No agents" description="Create your first agent to get started." />;
  }

  const globalPaused = settings?.agents_paused === "true";
  const agentSpendMap = new Map<string, number>();
  costs.forEach((cost: any) => {
    if (cost.agent_id) {
      agentSpendMap.set(cost.agent_id, (agentSpendMap.get(cost.agent_id) || 0) + (cost.costUsd || 0));
    }
  });

  const handleGlobalPause = async (paused: boolean) => {
    try {
      setError(null);
      await updateSettings({ agents_paused: paused ? "true" : "false" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update pause state");
    }
  };

  const handleStatusChange = async (agentId: string, newStatus: string) => {
    try {
      setError(null);
      await updateAgent({ agentId, data: { status: newStatus } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update agent");
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">Error</div>
          <div className="text-xs mt-1 font-mono">{error}</div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium text-slate-900">Global Pause</div>
            <div className="text-xs text-slate-500 mt-1">
              Pausing agents stops new runs from starting. Already-running agents continue.
            </div>
          </div>
          <button
            onClick={() => handleGlobalPause(!globalPaused)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              globalPaused ? "bg-red-500" : "bg-emerald-500"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                globalPaused ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-900 mb-3">Agents</div>
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-600 uppercase">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-600 uppercase">Status</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-600 uppercase">Model</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-600 uppercase">Monthly Spend</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agents.map((agent) => {
                const statusColor =
                  agent.status === "paused"
                    ? "bg-amber-50 text-amber-700"
                    : agent.status === "running"
                      ? "bg-blue-50 text-blue-700"
                      : "bg-slate-50 text-slate-700";

                return (
                  <tr key={agent.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{agent.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
                        {agent.status || "idle"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {agent.runtimeId && runtimes.find((r: any) => r.id === agent.runtimeId)?.model ? (
                        <span>{String(runtimes.find((r: any) => r.id === agent.runtimeId)?.model)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      ${(agentSpendMap.get(agent.id) || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {agent.status === "paused" ? (
                          <button
                            onClick={() => handleStatusChange(agent.id, "idle")}
                            className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                          >
                            Resume
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStatusChange(agent.id, "paused")}
                            className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                          >
                            Pause
                          </button>
                        )}
                        <a
                          href={`/agents/${agent.id}/runs`}
                          className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                        >
                          Runs
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
