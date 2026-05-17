// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DashboardWidgetGrid — renders the registry-driven Home dashboard.
// Each widget is wrapped in a per-widget error boundary + Suspense so
// one broken or slow widget never blacks out the page.
//
// Both slots share a 4-column grid. `slot` controls vertical
// ordering (primary above secondary with a gutter between); `size`
// controls horizontal footprint:
//   small  → 1 col
//   medium → 2 cols
//   large  → 4 cols (full row)
// On narrow viewports the grid collapses to 1 column and large stays full.

import { Component, Suspense } from "react";
import type { ComponentType, ErrorInfo, ReactNode } from "react";

import type {
  DashboardWidget,
  DashboardWidgetSize,
  DashboardWidgetSlot,
} from "@boringos/ui";

interface WidgetWithModule extends DashboardWidget {
  moduleId: string;
}

const SIZE_COL_CLASS: Record<DashboardWidgetSize, string> = {
  small: "col-span-1 md:col-span-1",
  medium: "col-span-1 md:col-span-2",
  large: "col-span-1 md:col-span-4",
};

const SLOT_GRID_CLASS: Record<DashboardWidgetSlot, string> = {
  primary: "grid grid-cols-1 md:grid-cols-4 gap-4",
  secondary: "mt-6 grid grid-cols-1 md:grid-cols-4 gap-4",
};

interface BoundaryProps {
  widgetId: string;
  moduleId: string;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class WidgetErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(
      `[dashboard] widget "${this.props.moduleId}:${this.props.widgetId}" threw:`,
      error,
      info,
    );
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-border bg-white p-4 text-xs text-muted">
          <div className="font-medium text-text">Widget failed to render</div>
          <div className="mt-1 truncate">{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

function WidgetSkeleton({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{title}</div>
      <div className="mt-3 h-16 animate-pulse rounded-sm bg-border/40" />
    </div>
  );
}

function SlotRow({
  slot,
  widgets,
}: {
  slot: DashboardWidgetSlot;
  widgets: ReadonlyArray<WidgetWithModule>;
}) {
  if (widgets.length === 0) return null;
  return (
    <div className={SLOT_GRID_CLASS[slot]}>
      {widgets.map((w) => {
        const Element = w.element as ComponentType<Record<string, never>>;
        return (
          <div key={`${w.moduleId}:${w.id}`} className={SIZE_COL_CLASS[w.size]}>
            <WidgetErrorBoundary widgetId={w.id} moduleId={w.moduleId}>
              <Suspense fallback={<WidgetSkeleton title={w.title} />}>
                <Element />
              </Suspense>
            </WidgetErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardWidgetGrid({
  widgets,
}: {
  widgets: ReadonlyArray<WidgetWithModule>;
}) {
  if (widgets.length === 0) return null;
  return (
    <>
      <SlotRow slot="primary" widgets={widgets.filter((w) => w.slot === "primary")} />
      <SlotRow slot="secondary" widgets={widgets.filter((w) => w.slot === "secondary")} />
    </>
  );
}
