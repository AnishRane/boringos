// SPDX-License-Identifier: AGPL-3.0-or-later
import { useInbox } from "@boringos/ui";
import { StatTile } from "./StatTile.js";

export function UnreadInboxWidget() {
  const inbox = useInbox("unread");
  return (
    <StatTile
      label="Unread inbox"
      value={inbox.data?.length ?? 0}
      hint="Triage queue"
    />
  );
}
