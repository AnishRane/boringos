// SPDX-License-Identifier: GPL-3.0-or-later
//
// Settings → Routines (Cron) panel.
// List, create, edit, delete, pause/resume, and manually trigger routines.

import { useState } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { useRoutines, useAgents, useWorkflows } from "@boringos/ui";
import { LoadingState, EmptyState } from "../_shared.js";

const CONCURRENCY_POLICIES = [
  { value: "skip_if_active", label: "Skip if running" },
  { value: "coalesce_if_active", label: "Coalesce if running" },
  { value: "allow_concurrent", label: "Allow concurrent" },
];

const DEFAULT_FORM = {
  title: "",
  targetType: "agent" as "agent" | "workflow",
  targetId: "",
  cronExpression: "0 */6 * * *",
  timezone: "UTC",
  concurrencyPolicy: "skip_if_active",
};

export function RoutinesPanel() {
  const { user } = useAuth();
  const { routines, isLoading: routinesLoading, createRoutine, updateRoutine, deleteRoutine, triggerRoutine } =
    useRoutines();
  const { agents } = useAgents();
  const { workflows } = useWorkflows();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ ...DEFAULT_FORM });

  if (!user?.role || user.role !== "admin") {
    return (
      <div className="rounded-md bg-accent-tint border border-accent px-4 py-3 text-sm text-accent">
        <div className="font-medium">Admin access required</div>
        <div className="text-xs mt-1">Only admins can manage routines.</div>
      </div>
    );
  }

  if (routinesLoading) return <LoadingState />;

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ ...DEFAULT_FORM });
  };

  const openCreate = () => {
    setError(null);
    setFormData({ ...DEFAULT_FORM });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (routine: Record<string, unknown>) => {
    setError(null);
    const assigneeAgentId = routine.assigneeAgentId as string | undefined;
    const workflowId = routine.workflowId as string | undefined;
    const isAgent = Boolean(assigneeAgentId);
    setFormData({
      title: (routine.title as string) ?? "",
      targetType: isAgent ? "agent" : "workflow",
      targetId: isAgent ? (assigneeAgentId ?? "") : (workflowId ?? ""),
      cronExpression: (routine.cronExpression as string) ?? DEFAULT_FORM.cronExpression,
      timezone: (routine.timezone as string) ?? "UTC",
      concurrencyPolicy: (routine.concurrencyPolicy as string) ?? "skip_if_active",
    });
    setEditingId(routine.id as string);
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      setError(null);
      if (editingId) {
        await updateRoutine({
          routineId: editingId,
          data: {
            title: formData.title,
            cronExpression: formData.cronExpression,
            timezone: formData.timezone,
            concurrencyPolicy: formData.concurrencyPolicy,
          },
        });
        closeForm();
        return;
      }
      const target = formData.targetType === "agent" ? { assigneeAgentId: formData.targetId } : { workflowId: formData.targetId };
      await createRoutine({
        title: formData.title,
        cronExpression: formData.cronExpression,
        timezone: formData.timezone,
        concurrencyPolicy: formData.concurrencyPolicy,
        ...target,
      });
      closeForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : editingId ? "Failed to update routine" : "Failed to create routine");
    }
  };

  const handleTogglePause = async (routine: Record<string, unknown>) => {
    try {
      setError(null);
      const id = routine.id as string;
      const isPaused = routine.status === "paused";
      await updateRoutine({
        routineId: id,
        data: { status: isPaused ? "active" : "paused" },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update routine status");
    }
  };

  const handleTrigger = async (routineId: string) => {
    try {
      setError(null);
      await triggerRoutine(routineId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger routine");
    }
  };

  const handleDelete = async (routineId: string) => {
    if (!window.confirm("Are you sure you want to delete this routine?")) return;
    try {
      setError(null);
      await deleteRoutine(routineId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete routine");
    }
  };

  const isEditing = editingId !== null;
  const headerButtonLabel = showForm ? "Cancel" : "New Routine";

  return (
    <div className="space-y-6 max-w-5xl">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">Error</div>
          <div className="text-xs mt-1 font-mono">{error}</div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <div className="text-sm font-medium text-text">Routines</div>
          <div className="text-xs text-muted mt-1">Automated schedules for agents and workflows</div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (showForm) closeForm();
            else openCreate();
          }}
          className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent transition-colors"
        >
          {headerButtonLabel}
        </button>
      </div>

      {showForm && (
        <div className="border border-border rounded-lg p-4 bg-bg">
          <div className="text-sm font-medium text-text mb-3">{isEditing ? "Edit Routine" : "New Routine"}</div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Gmail sync"
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Target Type</label>
                <select
                  value={formData.targetType}
                  onChange={(e) => setFormData({ ...formData, targetType: e.target.value as "agent" | "workflow", targetId: "" })}
                  disabled={isEditing}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="agent">Agent</option>
                  <option value="workflow">Workflow</option>
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">
                  {formData.targetType === "agent" ? "Agent" : "Workflow"}
                </label>
                <select
                  value={formData.targetId}
                  onChange={(e) => setFormData({ ...formData, targetId: e.target.value })}
                  disabled={isEditing}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">Select {formData.targetType === "agent" ? "an agent" : "a workflow"}</option>
                  {formData.targetType === "agent"
                    ? agents.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))
                    : workflows.map((w: any) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                </select>
              </div>
            </div>

            {isEditing && (
              <p className="text-xs text-muted">
                Target is fixed for existing routines — delete and recreate to change.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Cron Expression</label>
                <input
                  type="text"
                  value={formData.cronExpression}
                  onChange={(e) => setFormData({ ...formData, cronExpression: e.target.value })}
                  placeholder="0 */6 * * *"
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Timezone</label>
                <select
                  value={formData.timezone}
                  onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option>UTC</option>
                  <option>America/New_York</option>
                  <option>America/Los_Angeles</option>
                  <option>Europe/London</option>
                  <option>Europe/Paris</option>
                  <option>Asia/Tokyo</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Concurrency Policy</label>
              <select
                value={formData.concurrencyPolicy}
                onChange={(e) => setFormData({ ...formData, concurrencyPolicy: e.target.value })}
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {CONCURRENCY_POLICIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-3 py-1.5 rounded-md border border-border text-text-secondary text-xs font-medium hover:bg-bg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                disabled={!formData.title || (!isEditing && !formData.targetId)}
              >
                {isEditing ? "Save Changes" : "Create Routine"}
              </button>
            </div>
          </div>
        </div>
      )}

      {routines.length === 0 ? (
        <EmptyState
          title="No routines"
          description="Create a routine to automatically run agents or workflows on a schedule."
        />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Title</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Target</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Schedule</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Status</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {routines.map((routine: any) => {
                const targetName = routine.assigneeAgentId
                  ? agents.find((a: any) => a.id === routine.assigneeAgentId)?.name || "Unknown"
                  : workflows.find((w: any) => w.id === routine.workflowId)?.name || "Unknown";

                const status = routine.status || "active";
                const isPaused = status === "paused";

                const statusBadgeClass =
                  status === "active"
                    ? "bg-emerald-50 text-emerald-700"
                    : status === "paused"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-bg text-text-secondary";

                return (
                  <tr key={routine.id} className="hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-text">{routine.title}</td>
                    <td className="px-4 py-3 text-muted-strong text-xs">{String(targetName)}</td>
                    <td className="px-4 py-3 text-muted-strong text-xs font-mono">{routine.cronExpression}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {isPaused ? (
                          <button
                            type="button"
                            onClick={() => handleTogglePause(routine)}
                            className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors"
                          >
                            Resume
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleTogglePause(routine)}
                            className="text-xs px-2 py-1 rounded bg-bg border border-border text-text-secondary hover:bg-bg transition-colors"
                          >
                            Pause
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleTrigger(routine.id)}
                          disabled={isPaused}
                          className="text-xs px-2 py-1 rounded bg-accent-tint text-accent hover:bg-accent-tint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Run Now
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(routine)}
                          className="text-xs px-2 py-1 rounded border border-border text-text-secondary hover:bg-bg transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(routine.id)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
