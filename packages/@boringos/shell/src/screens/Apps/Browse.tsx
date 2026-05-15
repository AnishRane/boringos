// SPDX-License-Identifier: GPL-3.0-or-later
//
// Browse tab — placeholder. The real marketplace lands when the
// module catalog backend is wired (post-task_21). For now, the
// Installed tab is the working centerpiece; users add modules by
// having the host register them in modules.config.ts.

export function Browse() {
  return (
    <div className="text-center py-16 max-w-xl mx-auto">
      <h3 className="text-base font-medium text-text mb-2">Module marketplace coming soon</h3>
      <p className="text-sm text-muted">
        For now, modules are registered by the host application at boot
        (see <code className="font-mono text-xs">modules.config.ts</code>).
        Use the <strong>Installed</strong> tab to install / uninstall registered modules.
      </p>
    </div>
  );
}
