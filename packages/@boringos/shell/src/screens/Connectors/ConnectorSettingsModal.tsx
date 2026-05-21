// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-connector settings modal. Opened from the connector card's
// "Manage" button. Today its only control is Gmail's "Email sync"
// toggle, which flips `config.gmail.forwardSyncEnabled` via
// onToggleSync — the forward-sync ticker honors it without the
// connection being torn down. Built as a general per-connector
// settings surface so future connector options have a home.

import { useEffect, useState } from "react";
import type { ConnectorViewModel } from "./connectorsPresenter.js";

export interface ConnectorSettingsModalProps {
  vm: ConnectorViewModel;
  onToggleSync: (kind: string, enabled: boolean) => void;
  onClose: () => void;
}

export function ConnectorSettingsModal({
  vm,
  onToggleSync,
  onClose,
}: ConnectorSettingsModalProps) {
  // Optimistic local state for snappy toggle feedback; re-synced to the
  // view model if the server rejects and the parent refetches.
  const [enabled, setEnabled] = useState(vm.forwardSyncEnabled);

  useEffect(() => {
    setEnabled(vm.forwardSyncEnabled);
  }, [vm.forwardSyncEnabled]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Gmail (kind "google") is the only connector with a sync poll today.
  const hasEmailSync = vm.kind === "google";

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    onToggleSync(vm.kind, next);
  };

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
          {hasEmailSync ? (
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
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                data-testid="email-sync-toggle"
                onClick={toggle}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  enabled ? "bg-accent" : "bg-border"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    enabled ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          ) : (
            <p className="text-muted">No settings available for {vm.name} yet.</p>
          )}
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
