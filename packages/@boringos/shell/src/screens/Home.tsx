// SPDX-License-Identifier: BUSL-1.1
//
// Home — Executive Brief dashboard.
//
// Designed to look like the morning page a CEO actually reads:
//   - 4 KPI tiles (open work, agents online, unread, approvals)
//   - 8-week cost-flow sparkline (so spend is felt, not surprising)
//   - Operating pulse: today's routines + recent agent runs
//   - Top watch items: high-priority tasks
// All data is derived from existing framework hooks. No new endpoints.

import { useMemo } from "react";

import {
  useAgents,
  useCosts,
  useInbox,
  useRoutines,
  useTasks,
  useWorkflows,
} from "@boringos/ui";

import { useAuth } from "../auth/AuthProvider.js";
import { ScreenBody, ScreenHeader } from "./_shared.js";

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-text">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

function formatUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function CostSparkline({ costs }: { costs: Array<Record<string, unknown>> }) {
  // Bucket the last 8 calendar weeks of cost events into USD totals.
  const buckets = useMemo(() => {
    const out: Array<{ label: string; usd: number }> = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(start.getDate() - (i + 1) * 7);
      const end = new Date(now);
      end.setDate(end.getDate() - i * 7);
      const usd = costs.reduce((sum, c) => {
        const created = new Date(String(c.createdAt ?? c.created_at ?? ""));
        if (Number.isNaN(created.getTime())) return sum;
        if (created < start || created >= end) return sum;
        const v = Number(c.costUsd ?? c.cost_usd ?? 0);
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
      out.push({ label: `W-${i}`, usd });
    }
    return out;
  }, [costs]);

  const max = Math.max(1, ...buckets.map((b) => b.usd));
  const total = buckets.reduce((s, b) => s + b.usd, 0);

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-muted">
          Spend last 8 weeks
        </div>
        <div className="text-sm font-medium text-text">{formatUsd(total)}</div>
      </div>
      <div className="mt-3 flex h-20 items-end gap-1">
        {buckets.map((b) => {
          const h = Math.max(2, Math.round((b.usd / max) * 72));
          return (
            <div
              key={b.label}
              title={`${b.label}: ${formatUsd(b.usd)}`}
              className="flex-1 rounded-sm bg-accent/70"
              style={{ height: `${h}px` }}
            />
          );
        })}
      </div>
    </div>
  );
}

function OperatingPulse({
  routines,
  workflows,
  agents,
}: {
  routines: ReadonlyArray<{ status?: string | null }>;
  workflows: ReadonlyArray<unknown>;
  agents: ReadonlyArray<{ status?: string | null }>;
}) {
  const activeRoutines = routines.filter((r) => r.status !== "paused").length;
  const totalWorkflows = workflows.length;
  const onlineAgents = agents.filter(
    (a) => a.status === "running" || a.status === "idle",
  ).length;
  const items: Array<{ label: string; value: number; of?: number }> = [
    { label: "Routines active", value: activeRoutines, of: routines.length },
    { label: "Workflows", value: totalWorkflows },
    { label: "Agents online", value: onlineAgents, of: agents.length },
  ];

  return (
    <div className="rounded-lg border border-border bg-white p-4">
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

function WatchItems({
  tasks,
}: {
  tasks: ReadonlyArray<{
    id: string;
    title?: string;
    status?: string | null;
    priority?: string | null;
  }>;
}) {
  // High-priority tasks that aren't done — the things a CEO must look at today.
  const top = tasks
    .filter(
      (t) =>
        (t.priority === "high" || t.priority === "urgent") &&
        t.status !== "done" &&
        t.status !== "cancelled",
    )
    .slice(0, 5);
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-muted">
        Watch items
      </div>
      {top.length === 0 ? (
        <div className="mt-3 text-sm text-muted">Nothing on fire.</div>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((t) => (
            <li
              key={String(t.id)}
              className="flex items-start justify-between gap-3 text-sm"
            >
              <span className="text-text truncate">{String(t.title)}</span>
              <span className="text-xs text-muted whitespace-nowrap uppercase tracking-wide">
                {String(t.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Home() {
  const { user } = useAuth();
  const { tasks } = useTasks();
  const { agents } = useAgents();
  const inbox = useInbox("unread");
  const { costs } = useCosts();
  const { routines } = useRoutines();
  const { workflows } = useWorkflows();

  const pendingApprovals = (tasks ?? []).filter(
    (t) =>
      t.originKind === "agent_action" &&
      t.status !== "done" &&
      t.status !== "cancelled",
  );

  const openTasks = (tasks ?? []).filter(
    (t) => t.status !== "done" && t.status !== "cancelled" && t.originKind !== "copilot",
  );

  return (
    <>
      <ScreenHeader
        title={`Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        subtitle="Executive brief"
      />
      <ScreenBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatTile
            label="Open work"
            value={openTasks.length}
            hint={`${pendingApprovals.length} awaiting approval`}
          />
          <StatTile
            label="Agents online"
            value={(agents ?? []).filter((a) => a.status !== "archived").length}
            hint="Cabinet"
          />
          <StatTile
            label="Unread inbox"
            value={inbox.data?.length ?? 0}
            hint="Triage queue"
          />
          <StatTile
            label="Pending approvals"
            value={pendingApprovals.length}
            hint="Need decision"
          />
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <CostSparkline costs={(costs ?? []) as Array<Record<string, unknown>>} />
          <OperatingPulse
            routines={(routines ?? []) as ReadonlyArray<{ status?: string | null }>}
            workflows={workflows ?? []}
            agents={(agents ?? []) as ReadonlyArray<{ status?: string | null }>}
          />
          <WatchItems tasks={(tasks ?? []) as Parameters<typeof WatchItems>[0]["tasks"]} />
        </div>
      </ScreenBody>
    </>
  );
}
