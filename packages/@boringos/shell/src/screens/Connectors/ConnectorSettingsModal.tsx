// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-connector settings modal. Opened from the connector card's "Manage"
// button. Shows Email sync (Google only) and Writes Gate (all connectors).

import { useEffect, useState } from "react";
import type { ConnectorViewModel } from "./connectorsPresenter.js";

export interface ConnectorSettingsModalProps {
  vm: ConnectorViewModel;
  onToggleSync: (kind: string, enabled: boolean) => void;
  onToggleWritesGate: (kind: string, enabled: boolean) => void;
  onClose: () => void;
}

function Toggle({
  checked,
  testId,
  onChange,
}: {
  checked: boolean;
  testId?: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function ConnectorSettingsModal({
  vm,
  onToggleSync,
  onToggleWritesGate,
  onClose,
}: ConnectorSettingsModalProps) {
  const [syncEnabled, setSyncEnabled] = useState(vm.forwardSyncEnabled);
  const [gateEnabled, setGateEnabled] = useState(vm.writesGate);

  useEffect(() => { setSyncEnabled(vm.forwardSyncEnabled); }, [vm.forwardSyncEnabled]);
  useEffect(() => { setGateEnabled(vm.writesGate); }, [vm.writesGate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasEmailSync = vm.kind === "google";

  return (
    <div
      data-testid="connector-settings-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-accent/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-text">
            {vm.name} settings
          </h2>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm text-text-secondary">
          {hasEmailSync && (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-text">Email sync</p>
                <p className="text-xs text-muted mt-0.5">
                  Poll Gmail for new messages and route them to your inbox.
                  Pausing keeps the connection — no re-auth needed to resume.
                </p>
                {vm.lastSyncLabel && (
                  <p className="text-[11px] text-muted mt-1">
                    Last sync {vm.lastSyncLabel}
                  </p>
                )}
              </div>
              <Toggle
                checked={syncEnabled}
                testId="email-sync-toggle"
                onChange={() => {
                  const next = !syncEnabled;
                  setSyncEnabled(next);
                  onToggleSync(vm.kind, next);
                }}
              />
            </div>
          )}

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-text">Writes gate</p>
              <p className="text-xs text-muted mt-0.5">
                When on, agents must request approval before sending messages
                or making writes through this connector. Off by default —
                agents act freely.
              </p>
            </div>
            <Toggle
              checked={gateEnabled}
              testId="writes-gate-toggle"
              onChange={() => {
                const next = !gateEnabled;
                setGateEnabled(next);
                onToggleWritesGate(vm.kind, next);
              }}
            />
          </div>
        </div>

        <div className="px-5 pb-5 pt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-light"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
