// SPDX-License-Identifier: BUSL-1.1
//
// Workflows — v2 implementation.
//
// Lists workflows for the tenant and lets admins:
//   - View the DAG as a structured block list (kind + tool name +
//     inputs + edges) with the tool registry inlined for context
//   - Edit the canonical JSON {blocks, edges} in a textarea
//   - Run any workflow via the v2 `workflow.run` tool dispatcher
//   - Create a starter workflow from a template
//
// The visual canvas (xyflow + dagre) is a follow-up; this surface
// is functional + auditable today and matches the v2 block schema:
//   { id, kind: "trigger" | "tool" | "condition" | "for_each" |
//        "delay" | "transform" | "branch",
//     tool?, inputs?, config? }
// with edges:
//   { sourceBlockId, targetBlockId, sourceHandle? }

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import {
  EmptyState,
  LoadingState,
  ScreenBody,
  ScreenHeader,
} from "./_shared.js";

interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  type?: string;
  status?: string;
  blocks?: V2Block[];
  edges?: V2Edge[];
  createdAt?: string;
  updatedAt?: string;
}

interface V2Block {
  id: string;
  kind?: string;
  type?: string; // legacy v1 rows still in DB
  tool?: string;
  inputs?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

interface V2Edge {
  sourceBlockId: string;
  targetBlockId: string;
  sourceHandle?: string;
}

interface ToolRow {
  fullName: string;
  moduleId: string;
  description: string;
}

const STARTER_TEMPLATE = {
  blocks: [
    { id: "trigger", kind: "trigger" },
    {
      id: "fetch",
      kind: "tool",
      tool: "google.gmail.list_emails",
      inputs: { query: "is:unread", maxResults: 5 },
    },
    {
      id: "loop",
      kind: "for_each",
      config: {
        items: "{{fetch.messages}}",
        tool: "framework.tasks.create",
        inputs: {
          title: "Triage: {{item.subject}}",
          description: "From {{item.from}} — {{item.snippet}}",
        },
      },
    },
  ],
  edges: [
    { sourceBlockId: "trigger", targetBlockId: "fetch" },
    { sourceBlockId: "fetch", targetBlockId: "loop" },
  ],
};

function authHeaders(token: string | null, tenantId: string | undefined) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

export function Workflows() {
  const { user, token } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load both the tenant's workflows + the registered tool catalog.
  const refresh = async () => {
    if (!user?.tenantId) return;
    setError(null);
    try {
      const headers = authHeaders(token, user.tenantId);
      const [wfRes, toolsRes] = await Promise.all([
        fetch("/api/admin/workflows", { headers }),
        fetch("/api/admin/v2/tools", { headers }),
      ]);
      if (!wfRes.ok) throw new Error(`workflows: ${wfRes.status}`);
      const wfBody = await wfRes.json();
      setWorkflows(Array.isArray(wfBody) ? wfBody : (wfBody?.workflows ?? []));
      if (toolsRes.ok) {
        const t = (await toolsRes.json()) as { tools: ToolRow[] };
        setTools(t.tools);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId, token]);

  const active = useMemo(
    () => workflows?.find((w) => w.id === activeId) ?? null,
    [workflows, activeId],
  );

  const isAdmin = user?.role === "admin";
  if (!isAdmin) {
    return (
      <>
        <ScreenHeader title="Workflows" subtitle="DAG-based orchestration" />
        <ScreenBody>
          <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
            <div className="font-medium">Admin access required</div>
            <div className="text-xs mt-1">Only admins can manage workflows.</div>
          </div>
        </ScreenBody>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Workflows" subtitle="DAG-based orchestration · v2" />
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <nav className="w-72 border-r border-slate-100 overflow-y-auto shrink-0 flex flex-col">
          <div className="p-3 border-b border-slate-100">
            <NewWorkflowButton
              token={token}
              tenantId={user?.tenantId}
              onCreated={(id) => {
                refresh();
                setActiveId(id);
              }}
            />
          </div>
          {workflows === null ? (
            <LoadingState />
          ) : workflows.length === 0 ? (
            <div className="p-3 text-xs text-slate-500">
              No workflows yet. Click "New workflow" to start.
            </div>
          ) : (
            <ul>
              {workflows.map((wf) => (
                <li key={wf.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(wf.id)}
                    className={`block w-full text-left px-3 py-2 text-sm transition-colors border-l-2 ${
                      activeId === wf.id
                        ? "bg-slate-100 text-slate-900 border-slate-900 font-medium"
                        : "text-slate-700 hover:bg-slate-50 border-transparent"
                    }`}
                  >
                    <div className="truncate">{wf.name || "(untitled)"}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {wf.blocks?.length ?? 0} blocks
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <ScreenBody>
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700 mb-3">
              {error}
            </div>
          )}
          {!active ? (
            <EmptyState
              title="Select a workflow"
              description="Pick one on the left or create a new one with a starter template."
            />
          ) : (
            <WorkflowEditor
              key={active.id}
              workflow={active}
              tools={tools}
              token={token}
              tenantId={user?.tenantId}
              onSaved={refresh}
            />
          )}
        </ScreenBody>
      </div>
    </>
  );
}

function NewWorkflowButton(props: {
  token: string | null;
  tenantId: string | undefined;
  onCreated: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!props.tenantId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/workflows", {
        method: "POST",
        headers: authHeaders(props.token, props.tenantId),
        body: JSON.stringify({
          name: "New workflow",
          blocks: STARTER_TEMPLATE.blocks,
          edges: STARTER_TEMPLATE.edges,
        }),
      });
      if (!res.ok) throw new Error(`create failed ${res.status}`);
      const body = (await res.json()) as { id: string };
      props.onCreated(body.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={create}
      disabled={busy}
      className="w-full px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-800 disabled:opacity-50"
    >
      {busy ? "..." : "+ New workflow"}
    </button>
  );
}

function WorkflowEditor(props: {
  workflow: WorkflowSummary;
  tools: ToolRow[];
  token: string | null;
  tenantId: string | undefined;
  onSaved: () => void;
}) {
  const [name, setName] = useState(props.workflow.name);
  const [json, setJson] = useState(() =>
    JSON.stringify(
      {
        blocks: props.workflow.blocks ?? [],
        edges: props.workflow.edges ?? [],
      },
      null,
      2,
    ),
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      const v = JSON.parse(json);
      if (!Array.isArray(v?.blocks) || !Array.isArray(v?.edges)) {
        return null;
      }
      return v as { blocks: V2Block[]; edges: V2Edge[] };
    } catch {
      return null;
    }
  }, [json]);

  // Validate tool refs against the registry.
  const knownTools = useMemo(
    () => new Set(props.tools.map((t) => t.fullName)),
    [props.tools],
  );
  const invalidToolRefs = useMemo(() => {
    if (!parsed) return [];
    const out: string[] = [];
    for (const b of parsed.blocks) {
      if (b.kind === "tool" && b.tool && !knownTools.has(b.tool)) {
        out.push(b.tool);
      }
      const inner = (b.config as { tool?: string } | undefined)?.tool;
      if (inner && !knownTools.has(inner)) out.push(inner);
    }
    return Array.from(new Set(out));
  }, [parsed, knownTools]);

  const save = async () => {
    if (!parsed) {
      setParseError("Body must be valid JSON with `blocks` and `edges` arrays.");
      return;
    }
    setParseError(null);
    setSaveError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workflows/${props.workflow.id}`, {
        method: "PATCH",
        headers: authHeaders(props.token, props.tenantId),
        body: JSON.stringify({ name, blocks: parsed.blocks, edges: parsed.edges }),
      });
      if (!res.ok) throw new Error(`save failed ${res.status}`);
      props.onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setSaveError(null);
    setLastRun(null);
    try {
      // workflow.run is a v2 tool — call via /api/admin/v2/run-tool? No,
      // tools are JWT-authed (agent-side). For admin-triggered runs we
      // POST to /api/admin/workflows/:id/run if it exists; otherwise
      // call the tool directly via the framework's dispatch admin
      // shim. Simpler: call the v2 tool with the user's session token
      // — the framework allows admin-issued bearer tokens for tool
      // dispatch only when the host enables it. For now we fall back
      // to admin/workflows/:id/run.
      const res = await fetch(`/api/admin/workflows/${props.workflow.id}/run`, {
        method: "POST",
        headers: authHeaders(props.token, props.tenantId),
        body: "{}",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`run failed ${res.status}: ${body.slice(0, 200)}`);
      }
      const body = (await res.json()) as { runId?: string };
      setLastRun(body.runId ?? "(ran — no runId returned)");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-300"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || !parsed}
          className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "..." : "Save"}
        </button>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? "..." : "▶ Run"}
        </button>
      </div>

      {parseError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {parseError}
        </div>
      )}
      {saveError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {saveError}
        </div>
      )}
      {lastRun && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
          Run started: <code>{lastRun}</code>. Check Settings → Tool calls for
          per-block dispatches.
        </div>
      )}
      {invalidToolRefs.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
          Unknown tool reference(s):{" "}
          {invalidToolRefs.map((t) => (
            <code key={t} className="bg-white/60 px-1 rounded mr-1">
              {t}
            </code>
          ))}
          — install the owning module under Settings → Modules, or fix the
          name.
        </div>
      )}

      {/* Block summary */}
      {parsed && (
        <div className="rounded-md border border-slate-200 bg-white">
          <div className="text-xs font-medium text-slate-500 px-3 py-2 border-b border-slate-100">
            Blocks ({parsed.blocks.length})
          </div>
          <ul className="divide-y divide-slate-100">
            {parsed.blocks.map((b) => {
              const kind = b.kind ?? b.type ?? "tool";
              const toolDesc = props.tools.find((t) => t.fullName === b.tool)?.description;
              return (
                <li key={b.id} className="px-3 py-2 text-xs">
                  <div className="flex items-baseline gap-2">
                    <code className="text-slate-900">{b.id}</code>
                    <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 uppercase tracking-wide text-[10px]">
                      {kind}
                    </span>
                    {b.tool && (
                      <code className="text-slate-700">{b.tool}</code>
                    )}
                  </div>
                  {toolDesc && <div className="text-slate-500 mt-1">{toolDesc}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* JSON editor */}
      <div>
        <div className="text-xs font-medium text-slate-500 mb-2">
          DAG (JSON · v2 schema)
        </div>
        <textarea
          rows={20}
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
          className={`w-full rounded-md border px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-300 ${
            parsed ? "border-slate-200" : "border-red-300 bg-red-50"
          }`}
        />
      </div>

      {/* Tool palette */}
      <details className="rounded-md border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
          Available tool blocks ({props.tools.length})
        </summary>
        <div className="px-3 py-2 max-h-64 overflow-y-auto text-xs space-y-0.5">
          {props.tools.map((t) => (
            <div key={t.fullName} className="font-mono text-slate-700">
              <code>{t.fullName}</code>{" "}
              <span className="text-slate-500">— {t.description}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
