// SPDX-License-Identifier: BUSL-1.1
//
// Home — at-a-glance dashboard tiles for tasks, agents, inbox, approvals.

import { useAgents, useInbox, useTasks } from "@boringos/ui";

import { useAuth } from "../auth/AuthProvider.js";
import { ScreenBody, ScreenHeader } from "./_shared.js";

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-text">{value}</div>
    </div>
  );
}

export function Home() {
  const { user } = useAuth();
  const { tasks } = useTasks();
  const { agents } = useAgents();
  const inbox = useInbox("unread");
  const pendingApprovals = (tasks ?? []).filter(
    (t) => t.originKind === "agent_action" && t.status !== "done" && t.status !== "cancelled",
  );

  return (
    <>
      <ScreenHeader
        title={`Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        subtitle="At a glance"
      />
      <ScreenBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatTile label="Open tasks" value={tasks?.length ?? 0} />
          <StatTile label="Active agents" value={agents?.length ?? 0} />
          <StatTile label="Unread inbox" value={inbox.data?.length ?? 0} />
          <StatTile label="Pending approvals" value={pendingApprovals.length} />
        </div>
      </ScreenBody>
    </>
  );
}
