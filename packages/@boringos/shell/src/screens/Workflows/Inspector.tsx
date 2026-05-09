// SPDX-License-Identifier: BUSL-1.1
//
// Right-pane inspector. Three sections — Inputs (form), Last run
// (resolved I/O), and per-block actions: pin output, replay from here.

import type { BlockRun, ToolRow, V2Block } from "./types.js";
import { BlockForm } from "./InspectorForms.js";
import { blockKind, kindAccent } from "./utils.js";

export interface InspectorProps {
  block: V2Block | null;
  tools: ToolRow[];
  onChange: (patch: Partial<V2Block>) => void;
  onDelete: () => void;
  blockRun?: BlockRun | null;
  onTogglePin: () => void;
  onReplayFromHere: () => void;
  canReplay: boolean;
}

export function Inspector({
  block,
  tools,
  onChange,
  onDelete,
  blockRun,
  onTogglePin,
  onReplayFromHere,
  canReplay,
}: InspectorProps) {
  if (!block) {
    return (
      <aside className="w-[300px] shrink-0 border-l border-slate-100 overflow-y-auto p-4 text-xs text-slate-400">
        <div className="rounded border border-dashed border-slate-200 px-3 py-6 text-center">
          Select a block to inspect.
          <div className="mt-1 text-[11px] text-slate-300">
            <kbd className="font-mono">⌘K</kbd> to insert one.
          </div>
        </div>
      </aside>
    );
  }
  const kind = blockKind(block);
  const accent = kindAccent(kind);
  const cfg = (block.config ?? {}) as { pinned?: boolean; pinnedOutput?: unknown };
  const isPinned = cfg.pinned === true && cfg.pinnedOutput !== undefined;

  return (
    <aside className="w-[300px] shrink-0 border-l border-slate-100 overflow-y-auto flex flex-col">
      <header className="px-4 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span
            className={`text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded ${accent.bg} ${accent.text}`}
          >
            {accent.label}
          </span>
          <code className="text-[10px] font-mono text-slate-400 ml-auto">{block.id}</code>
        </div>
        <div className="mt-1.5 text-sm font-medium text-slate-900 truncate">
          {block.name || (kind === "tool" ? block.tool : kind)}
        </div>
      </header>

      <div className="px-4 py-4 flex-1">
        <BlockForm block={block} onChange={onChange} tools={tools} />

        {blockRun && (
          <section className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center mb-2">
              <h3 className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 flex-1">
                Last run
              </h3>
              {canReplay && (
                <button
                  type="button"
                  onClick={onReplayFromHere}
                  className="text-[10px] text-slate-500 hover:text-slate-900 px-2 py-0.5 rounded border border-slate-200 hover:border-slate-300"
                >
                  ↻ Replay from here
                </button>
              )}
            </div>
            <RunPanel run={blockRun} />
          </section>
        )}

        {/* Pin toggle — works only when there's a last-run output to cache */}
        {(blockRun?.output || isPinned) && (
          <section className="mt-5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onTogglePin}
              className={`w-full text-left flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border ${
                isPinned
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isPinned ? "bg-amber-400" : "bg-slate-300"}`} />
              <span className="flex-1">
                {isPinned ? "Output pinned (dev runs use cache)" : "Pin last output for dev runs"}
              </span>
            </button>
          </section>
        )}
      </div>

      <footer className="px-4 py-3 border-t border-slate-100">
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] text-rose-600 hover:text-rose-700 hover:underline"
        >
          Delete block
        </button>
      </footer>
    </aside>
  );
}

function RunPanel({ run }: { run: BlockRun }) {
  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">status</span>
        <code className="font-mono text-slate-900">{run.status}</code>
        {run.durationMs != null && (
          <span className="ml-auto font-mono text-slate-400">{run.durationMs}ms</span>
        )}
      </div>
      {run.error && (
        <div className="rounded bg-rose-50 border border-rose-200 px-2 py-1.5 text-rose-700 text-[10px] font-mono break-all">
          {run.error}
        </div>
      )}
      {run.output && (
        <details className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Output
          </summary>
          <pre className="mt-1 text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {JSON.stringify(run.output, null, 2)}
          </pre>
        </details>
      )}
      {run.resolvedConfig && (
        <details className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Resolved config
          </summary>
          <pre className="mt-1 text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {JSON.stringify(run.resolvedConfig, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
