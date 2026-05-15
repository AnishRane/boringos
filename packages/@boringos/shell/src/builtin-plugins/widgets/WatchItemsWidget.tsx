// SPDX-License-Identifier: GPL-3.0-or-later
//
// High-priority, not-done tasks — the things to look at today.

import { useTasks } from "@boringos/ui";

interface WatchItem {
  id: string;
  title?: string;
  status?: string | null;
  priority?: string | null;
}

export function WatchItemsWidget() {
  const { tasks } = useTasks();
  const list = (tasks ?? []) as ReadonlyArray<WatchItem>;
  const top = list
    .filter(
      (t) =>
        (t.priority === "high" || t.priority === "urgent") &&
        t.status !== "done" &&
        t.status !== "cancelled",
    )
    .slice(0, 5);

  return (
    <div className="rounded-lg border border-border bg-white p-4 h-full">
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
