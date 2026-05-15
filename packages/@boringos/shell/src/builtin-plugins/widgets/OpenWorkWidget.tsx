// SPDX-License-Identifier: GPL-3.0-or-later
import { useTasks } from "@boringos/ui";
import { StatTile } from "./StatTile.js";

export function OpenWorkWidget() {
  const { tasks } = useTasks();
  const list = tasks ?? [];
  const open = list.filter(
    (t) => t.status !== "done" && t.status !== "cancelled" && t.originKind !== "copilot",
  );
  const pendingApprovals = list.filter(
    (t) =>
      t.originKind === "agent_action" &&
      t.status !== "done" &&
      t.status !== "cancelled",
  );
  return (
    <StatTile
      label="Open work"
      value={open.length}
      hint={`${pendingApprovals.length} awaiting approval`}
    />
  );
}
