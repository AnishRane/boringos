// SPDX-License-Identifier: GPL-3.0-or-later
import { useTasks } from "@boringos/ui";
import { StatTile } from "./StatTile.js";

export function PendingApprovalsWidget() {
  const { tasks } = useTasks();
  const value = (tasks ?? []).filter(
    (t) =>
      t.originKind === "agent_action" &&
      t.status !== "done" &&
      t.status !== "cancelled",
  ).length;
  return <StatTile label="Pending approvals" value={value} hint="Need decision" />;
}
