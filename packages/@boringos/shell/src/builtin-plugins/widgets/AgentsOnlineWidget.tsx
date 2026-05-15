// SPDX-License-Identifier: GPL-3.0-or-later
import { useAgents } from "@boringos/ui";
import { StatTile } from "./StatTile.js";

export function AgentsOnlineWidget() {
  const { agents } = useAgents();
  const value = (agents ?? []).filter((a) => a.status !== "archived").length;
  return <StatTile label="Agents online" value={value} hint="Cabinet" />;
}
