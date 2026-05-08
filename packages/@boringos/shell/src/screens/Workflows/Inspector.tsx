// SPDX-License-Identifier: BUSL-1.1
//
// Right-pane inspector. v2.1: per-kind form + raw config preview.
// Future (v2.2): three-tab Inputs / Params / Output with drag-to-template.

import type { BlockRun, ToolRow, V2Block } from "./types.js";
import { BlockForm } from "./InspectorForms.js";
import { blockKind, kindAccent } from "./utils.js";

export interface InspectorProps {
  block: V2Block | null;
  tools: ToolRow[];
  onChange: (patch: Partial<V2Block>) => void;
  onDelete: () => void;
  /** When in run mode, the run's per-block detail. */
  blockRun?: BlockRun | null;
}

export function Inspector({ block, tools, onChange, onDelete, blockRun }: InspectorProps) {
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
            <h3 className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">
              Last run
            </h3>
            <RunPanel run={blockRun} />
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
