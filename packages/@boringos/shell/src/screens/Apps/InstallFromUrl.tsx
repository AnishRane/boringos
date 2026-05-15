// SPDX-License-Identifier: GPL-3.0-or-later
//
// Install from URL — placeholder. The real flow lands when the
// module install endpoint accepts a remote bundle reference. For
// now, modules are installed by the host registering them at boot;
// the Installed tab manages per-tenant install state.

export function InstallFromUrl() {
  return (
    <div className="text-center py-16 max-w-xl mx-auto">
      <h3 className="text-base font-medium text-text mb-2">URL install coming soon</h3>
      <p className="text-sm text-muted">
        Modules are currently registered by the host application at boot.
        To add a module, install its package in the workspace and add an
        entry to <code className="font-mono text-xs">modules.config.ts</code>.
      </p>
    </div>
  );
}
