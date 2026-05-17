// SPDX-License-Identifier: AGPL-3.0-or-later
import { useAgents, useRoutines, useWorkflows } from "@boringos/ui";

export function OperatingPulseWidget() {
  const { routines } = useRoutines();
  const { workflows } = useWorkflows();
  const { agents } = useAgents();

  const routineRows = (routines ?? []) as ReadonlyArray<{ status?: string | null }>;
  const agentRows = (agents ?? []) as ReadonlyArray<{ status?: string | null }>;

  const activeRoutines = routineRows.filter((r) => r.status !== "paused").length;
  const totalWorkflows = (workflows ?? []).length;
  const onlineAgents = agentRows.filter(
    (a) => a.status === "running" || a.status === "idle",
  ).length;

  const items: Array<{ label: string; value: number; of?: number }> = [
    { label: "Routines active", value: activeRoutines, of: routineRows.length },
    { label: "Workflows", value: totalWorkflows },
    { label: "Agents online", value: onlineAgents, of: agentRows.length },
  ];

  return (
    <div className="rounded-lg border border-border bg-white p-4 h-full">
      <div className="text-xs uppercase tracking-wide text-muted">
        Operating pulse
      </div>
      <div className="mt-3 space-y-2">
        {items.map((it) => (
          <div
            key={it.label}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-muted-strong">{it.label}</span>
            <span className="font-medium text-text">
              {it.value}
              {typeof it.of === "number" ? (
                <span className="text-muted"> / {it.of}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
