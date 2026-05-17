// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 8-week cost-flow sparkline. Bucket cost events into weekly USD
// totals so spend is felt, not surprising.

import { useMemo } from "react";
import { useCosts } from "@boringos/ui";

function formatUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

export function CostSparklineWidget() {
  const { costs } = useCosts();
  const rows = (costs ?? []) as Array<Record<string, unknown>>;

  const buckets = useMemo(() => {
    const out: Array<{ label: string; usd: number }> = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(start.getDate() - (i + 1) * 7);
      const end = new Date(now);
      end.setDate(end.getDate() - i * 7);
      const usd = rows.reduce((sum, c) => {
        const created = new Date(String(c.createdAt ?? c.created_at ?? ""));
        if (Number.isNaN(created.getTime())) return sum;
        if (created < start || created >= end) return sum;
        const v = Number(c.costUsd ?? c.cost_usd ?? 0);
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
      out.push({ label: `W-${i}`, usd });
    }
    return out;
  }, [rows]);

  const max = Math.max(1, ...buckets.map((b) => b.usd));
  const total = buckets.reduce((s, b) => s + b.usd, 0);

  return (
    <div className="rounded-lg border border-border bg-white p-4 h-full">
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
