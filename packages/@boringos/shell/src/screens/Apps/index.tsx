// SPDX-License-Identifier: BUSL-1.1
//
// Modules screen — single coherent page for upload, browse, install,
// uninstall, and delete of `.hebbsmod` packages plus built-in modules.
//
// task_22 U4.2 / U4.3 / U4.4 — rebuilt from the previous three-tab
// (Browse / Installed / Install from URL) layout. The screen now joins
// three sources of truth:
//
//   getModulePackages() → host-global module_packages rows (uploaded)
//   getInstalls()       → per-tenant module_installs rows
//   getModules()        → registry view (tools + skills counts, name)
//
// Each visible row in the list is one logical (id, version) pair. The
// per-card state machine is documented in the `cardState()` helper.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  AppWindow,
  ChevronDown,
  Loader2,
  MoreVertical,
  Package,
  Plug,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import {
  useClient,
  useInstalledModulesState,
  useInstallModule,
  useRealtimeEvent,
  useUninstallModule,
  type ModuleDeleteResult,
  type ModuleInfo,
  type ModulePackageInfo,
  type ModuleUploadResult,
} from "@boringos/ui";

import { ScreenBody, ScreenHeader } from "../_shared.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";

// ─────────────────────────────────────────────────────────────────────
// Per-card state machine.
//
// `package` is the host-global module_packages row (uploaded bundle).
// `install` is the per-tenant module_installs row.
// `registry` is the live ModuleRegistry view from getModules().
//
//  package | install (match)        | state            | primary action
//  ─────────────────────────────────────────────────────────────────────
//  yes     | yes  (same version)    | installed        | Uninstall
//  yes     | yes  (different ver)   | update-available | Update (uninstall → install)
//  yes     | no                     | available        | Install
//  no      | yes                    | orphaned         | Force-uninstall
//  no      | no   (built-in only)   | builtin-*        | Install / Uninstall
//
// Built-in modules show up in `registry` but never in `packages`. We
// fall back to `available` / `installed` for those, but the "Delete
// package" action is hidden because there's no package row to delete.
// ─────────────────────────────────────────────────────────────────────

type CardState =
  | "installed"
  | "update-available"
  | "available"
  | "orphaned";

interface CardRow {
  id: string;
  /** Display version: package.version if present else registry.version. */
  version: string;
  name: string;
  description: string;
  kind: ModulePackageInfo["kind"] | null;
  state: CardState;
  /** True when there's no module_packages row (i.e. host-registered). */
  isBuiltin: boolean;
  pkg: ModulePackageInfo | null;
  registry: ModuleInfo | null;
  installedVersion: string | null;
  toolsCount: number;
  skillsCount: number;
  provides: string[];
  dependsOn: ModuleInfo["dependsOn"];
  publisher: string | null;
}

function buildRows(
  packages: ModulePackageInfo[],
  registry: ModuleInfo[],
  installed: Set<string>,
  installRows: { moduleId: string; version?: string | null }[],
): CardRow[] {
  const installByModuleId = new Map<string, string | null>();
  for (const r of installRows) {
    installByModuleId.set(r.moduleId, (r.version as string | undefined) ?? null);
  }
  const registryById = new Map(registry.map((m) => [m.id, m]));
  const packagesById = new Map<string, ModulePackageInfo>();
  for (const p of packages) packagesById.set(p.id, p);

  const seen = new Set<string>();
  const rows: CardRow[] = [];

  // 1. Every uploaded package gets a card.
  for (const pkg of packages) {
    seen.add(pkg.id);
    const reg = registryById.get(pkg.id) ?? null;
    const installedVersion = installByModuleId.get(pkg.id) ?? null;
    const isInstalled = installed.has(pkg.id);
    let state: CardState;
    if (!isInstalled) state = "available";
    else if (installedVersion && installedVersion !== pkg.version)
      state = "update-available";
    else state = "installed";
    rows.push(makeRow({ pkg, reg, installedVersion, state, isBuiltin: false }));
  }

  // 2. Built-in modules — in registry but no package row.
  for (const reg of registry) {
    if (seen.has(reg.id)) continue;
    seen.add(reg.id);
    const installedVersion = installByModuleId.get(reg.id) ?? null;
    const isInstalled = installed.has(reg.id);
    const state: CardState = isInstalled ? "installed" : "available";
    rows.push(makeRow({ pkg: null, reg, installedVersion, state, isBuiltin: true }));
  }

  // 3. Orphaned installs — install row exists but no package + no
  // registry entry. Rare but worth surfacing so the user can clean up.
  for (const ir of installRows) {
    if (seen.has(ir.moduleId)) continue;
    seen.add(ir.moduleId);
    rows.push(
      makeRow({
        pkg: null,
        reg: null,
        installedVersion: (ir.version as string | undefined) ?? null,
        state: "orphaned",
        isBuiltin: false,
        idOverride: ir.moduleId,
      }),
    );
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function makeRow(args: {
  pkg: ModulePackageInfo | null;
  reg: ModuleInfo | null;
  installedVersion: string | null;
  state: CardState;
  isBuiltin: boolean;
  idOverride?: string;
}): CardRow {
  const { pkg, reg, installedVersion, state, isBuiltin } = args;
  const id = args.idOverride ?? pkg?.id ?? reg?.id ?? "";
  const version = pkg?.version ?? reg?.version ?? installedVersion ?? "—";
  const name = reg?.name ?? id;
  const description =
    reg?.description ??
    (state === "orphaned"
      ? "Installed but neither uploaded nor host-registered. Force-uninstall to clean up."
      : "");
  const kind: ModulePackageInfo["kind"] | null = pkg?.kind ?? null;
  const publisher =
    pkg?.signaturePublisherId !== undefined && pkg?.signaturePublisherId !== null
      ? pkg.signaturePublisherId
      : null;
  return {
    id,
    version,
    name,
    description,
    kind,
    state,
    isBuiltin,
    pkg,
    registry: reg,
    installedVersion,
    toolsCount: reg?.tools.length ?? 0,
    skillsCount: reg?.skills.length ?? 0,
    provides: reg?.provides ?? [],
    dependsOn: reg?.dependsOn ?? [],
    publisher,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────

const RESTART_DISMISS_KEY = "boringos.modules.restartBanner.dismissed";

export function Modules() {
  const client = useClient();
  const qc = useQueryClient();

  const packagesQuery = useQuery({
    queryKey: ["module-packages"],
    queryFn: () => client.getModulePackages(),
    staleTime: 30_000,
  });
  const modulesQuery = useQuery<ModuleInfo[]>({
    queryKey: ["modules"],
    queryFn: () => client.getModules(),
    staleTime: 30_000,
  });
  const installsQuery = useQuery({
    queryKey: ["installs", client.tenantId ?? null],
    queryFn: () => client.getInstalls(),
    staleTime: 30_000,
    enabled: !!client.tenantId,
  });
  const { installed } = useInstalledModulesState();

  // Realtime SSE — invalidate the three queries on relevant events.
  // The framework already broadcasts module:installed / :uninstalled;
  // module:uploaded / :deleted are TODO server-side (see report §6) —
  // until they ship we rely on the explicit invalidations the mutations
  // below trigger.
  useRealtimeEvent("module:installed", () => {
    qc.invalidateQueries({ queryKey: ["installs"] });
  });
  useRealtimeEvent("module:uninstalled", () => {
    qc.invalidateQueries({ queryKey: ["installs"] });
  });
  useRealtimeEvent("module:uploaded", () => {
    qc.invalidateQueries({ queryKey: ["module-packages"] });
    qc.invalidateQueries({ queryKey: ["modules"] });
  });
  useRealtimeEvent("module:deleted", () => {
    qc.invalidateQueries({ queryKey: ["module-packages"] });
    qc.invalidateQueries({ queryKey: ["modules"] });
    qc.invalidateQueries({ queryKey: ["installs"] });
  });

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["module-packages"] });
    qc.invalidateQueries({ queryKey: ["modules"] });
    qc.invalidateQueries({ queryKey: ["installs"] });
  };

  // Restart-recommended banner — sticky across the session.
  const [restartBannerVisible, setRestartBannerVisible] = useState<boolean>(
    () => {
      try {
        return sessionStorage.getItem(RESTART_DISMISS_KEY) !== "1";
      } catch {
        return true;
      }
    },
  );
  const [restartBannerActive, setRestartBannerActive] = useState(false);
  const flagRestart = () => {
    setRestartBannerActive(true);
    try {
      sessionStorage.removeItem(RESTART_DISMISS_KEY);
    } catch {}
    setRestartBannerVisible(true);
  };
  const dismissRestartBanner = () => {
    try {
      sessionStorage.setItem(RESTART_DISMISS_KEY, "1");
    } catch {}
    setRestartBannerVisible(false);
  };

  // Details modal + delete-confirm dialog state.
  const [detailsFor, setDetailsFor] = useState<CardRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    | {
        row: CardRow;
        tenants: string[];
        message: string;
      }
    | null
  >(null);

  // Rows (joined view).
  const rows = useMemo(
    () =>
      buildRows(
        packagesQuery.data ?? [],
        modulesQuery.data ?? [],
        installed,
        // installs rows include `version` opportunistically — see
        // InstallInfo. Cast through `unknown` so the optional field is
        // surfaced cleanly to buildRows.
        ((installsQuery.data ?? []) as unknown) as {
          moduleId: string;
          version?: string | null;
        }[],
      ),
    [packagesQuery.data, modulesQuery.data, installed, installsQuery.data],
  );

  const isLoading =
    packagesQuery.isLoading || modulesQuery.isLoading || installsQuery.isLoading;

  // Upload flow.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const uploadMut = useMutation<ModuleUploadResult, Error, File | Blob>({
    mutationFn: (file: File | Blob) => client.uploadModulePackage(file),
    onSettled: () => refetchAll(),
  });

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList || (Array.isArray(fileList) ? fileList.length === 0 : fileList.length === 0))
      return;
    const file = Array.isArray(fileList) ? fileList[0] : fileList[0];
    if (!file) return;
    if (!isHebbsmod(file)) {
      toast.error(`"${file.name}" is not a .hebbsmod file.`);
      return;
    }
    const t = toast.loading(`Uploading ${file.name}…`);
    const res = await uploadMut.mutateAsync(file);
    if (res.ok) {
      toast.success(
        `Installed ${res.id}@${res.version} — ${res.toolsAdded} tool${
          res.toolsAdded === 1 ? "" : "s"
        }, ${res.skillsAdded} skill${res.skillsAdded === 1 ? "" : "s"}`,
        { id: t },
      );
    } else {
      const msg = res.error?.message ?? `Upload failed (${res.error?.code ?? "unknown"})`;
      toast.error(msg, { id: t });
    }
  }

  // Drop zone handlers — HTML5 drag/drop.
  return (
    <>
      <ScreenHeader
        title="Modules"
        subtitle="Install modules — drop a .hebbsmod here, or browse installed ones."
      />
      <ScreenBody>
        <div className="max-w-4xl space-y-6">
          {restartBannerActive && restartBannerVisible && (
            <RestartBanner onDismiss={dismissRestartBanner} />
          )}

          <DropZone
            dragOver={dragOver}
            busy={uploadMut.isPending}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            onPickFile={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".hebbsmod,application/zip"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              // Reset so the same file can be picked again.
              if (e.target) e.target.value = "";
            }}
          />

          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Loading modules…
            </div>
          ) : rows.length === 0 ? (
            <EmptyModulesState onPickFile={() => fileInputRef.current?.click()} />
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <ModuleCard
                  key={`${row.id}@${row.version}`}
                  row={row}
                  onChanged={refetchAll}
                  onRestart={flagRestart}
                  onDetails={() => setDetailsFor(row)}
                  onRequestForceDelete={(tenants, message) =>
                    setConfirmDelete({ row, tenants, message })
                  }
                />
              ))}
            </div>
          )}
        </div>

        <DetailsModal row={detailsFor} onClose={() => setDetailsFor(null)} />
        <ForceDeleteDialog
          state={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirmed={(restart) => {
            setConfirmDelete(null);
            if (restart) flagRestart();
            refetchAll();
          }}
        />
      </ScreenBody>
    </>
  );
}

function isHebbsmod(file: File | Blob): boolean {
  // FormData accepts Blob, but the dropzone only ever gives us File
  // (which has `name`). Treat anything without a name as a pass —
  // the server will reject it with a clear error if invalid.
  const name = (file as File).name;
  if (!name) return true;
  return /\.hebbsmod$/i.test(name);
}

// ─────────────────────────────────────────────────────────────────────
// Drop zone
// ─────────────────────────────────────────────────────────────────────

function DropZone(props: {
  dragOver: boolean;
  busy: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onPickFile: () => void;
}) {
  return (
    <div
      onDragOver={props.onDragOver}
      onDragEnter={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      className={`rounded-xl border-2 border-dashed transition-colors px-6 py-10 flex flex-col items-center text-center ${
        props.dragOver
          ? "border-accent bg-accent-tint/40"
          : "border-border bg-bg-warm/30"
      }`}
    >
      <div className="rounded-full bg-surface w-12 h-12 flex items-center justify-center border border-border mb-3">
        {props.busy ? (
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
        ) : (
          <UploadIcon className="w-5 h-5 text-accent" />
        )}
      </div>
      <div className="text-sm font-medium text-text">
        {props.busy ? "Uploading…" : "Drop a .hebbsmod file here"}
      </div>
      <div className="text-xs text-muted mt-1">
        or{" "}
        <button
          type="button"
          onClick={props.onPickFile}
          disabled={props.busy}
          className="text-accent hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          choose a file
        </button>{" "}
        to upload
      </div>
      <div className="text-[11px] text-muted mt-3">
        Built with{" "}
        <code className="font-mono">pnpm pack-modules</code> — see
        BUILD-A-MODULE.md.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Module card
// ─────────────────────────────────────────────────────────────────────

function ModuleCard({
  row,
  onChanged,
  onRestart,
  onDetails,
  onRequestForceDelete,
}: {
  row: CardRow;
  onChanged: () => void;
  onRestart: () => void;
  onDetails: () => void;
  onRequestForceDelete: (tenants: string[], message: string) => void;
}) {
  const client = useClient();
  const installMut = useInstallModule();
  const uninstallMut = useUninstallModule();
  const [busy, setBusy] = useState<null | "install" | "uninstall" | "update" | "delete">(
    null,
  );
  const [menuOpen, setMenuOpen] = useState(false);

  const stateBadge = renderStateBadge(row.state);
  const Icon = pickIcon(row.kind);
  const kindLabel = pickKindLabel(row.kind, row.registry);

  async function doInstall() {
    setBusy("install");
    const t = toast.loading(`Installing ${row.name}…`);
    try {
      const r = await installMut.mutateAsync(row.id);
      if (r.ok) toast.success(`Installed ${row.name}`, { id: t });
      else toast.error(r.hookError ?? "Install failed", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: t });
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  async function doUninstall(kind: "uninstall" | "force-uninstall") {
    setBusy("uninstall");
    const t = toast.loading(`Uninstalling ${row.name}…`);
    try {
      const r = await uninstallMut.mutateAsync(row.id);
      if (r.ok)
        toast.success(
          kind === "force-uninstall"
            ? `Cleared orphan install for ${row.name}`
            : `Uninstalled ${row.name}`,
          { id: t },
        );
      else toast.error(r.hookError ?? "Uninstall failed", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: t });
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  async function doUpdate() {
    setBusy("update");
    const t = toast.loading(
      `Updating ${row.name} → v${row.version}…`,
    );
    try {
      const u = await uninstallMut.mutateAsync(row.id);
      if (!u.ok) {
        toast.error(u.hookError ?? "Uninstall step failed", { id: t });
        return;
      }
      const i = await installMut.mutateAsync(row.id);
      if (i.ok)
        toast.success(`Updated ${row.name} to v${row.version}`, { id: t });
      else toast.error(i.hookError ?? "Install step failed", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: t });
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  async function doDeletePackage(force = false): Promise<ModuleDeleteResult | null> {
    if (!row.pkg) return null;
    setBusy("delete");
    const t = toast.loading(
      force
        ? `Force-deleting ${row.name}@${row.version}…`
        : `Deleting ${row.name}@${row.version}…`,
    );
    try {
      const r = await client.deleteModulePackage(row.id, row.version, force);
      if (r.ok) {
        const msgs = [
          `${r.toolsRemoved} tool${r.toolsRemoved === 1 ? "" : "s"} removed`,
          `${r.skillsRemoved} skill${r.skillsRemoved === 1 ? "" : "s"} removed`,
        ];
        if (r.restartRecommended) msgs.push("restart recommended");
        toast.success(`Deleted ${row.name}@${row.version} — ${msgs.join(", ")}`, {
          id: t,
        });
        if (r.restartRecommended) onRestart();
        return r;
      }
      if (r.error.code === "installed" && r.error.tenants && !force) {
        toast.dismiss(t);
        onRequestForceDelete(r.error.tenants, r.error.message);
        return r;
      }
      toast.error(r.error.message ?? `Delete failed (${r.error.code})`, { id: t });
      return r;
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  const primary = renderPrimary(row, busy, {
    onInstall: doInstall,
    onUninstall: () => doUninstall("uninstall"),
    onUpdate: doUpdate,
    onForceUninstall: () => doUninstall("force-uninstall"),
  });

  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-md bg-bg-warm border border-border flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-text-secondary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm font-medium text-text truncate">{row.name}</div>
              <span className="text-xs text-muted">v{row.version}</span>
              {kindLabel && (
                <span className="text-[10px] uppercase tracking-wide rounded bg-bg-warm text-text-secondary border border-border px-1.5 py-0.5">
                  {kindLabel}
                </span>
              )}
              {row.isBuiltin && (
                <span className="text-[10px] uppercase tracking-wide rounded bg-blue-50 text-blue-700 px-1.5 py-0.5">
                  Built-in
                </span>
              )}
              {stateBadge}
              {row.pkg && row.publisher === null && (
                <span className="text-[10px] uppercase tracking-wide rounded bg-yellow-50 text-yellow-800 border border-yellow-200 px-1.5 py-0.5">
                  Unsigned (dev)
                </span>
              )}
              {row.publisher && (
                <span className="text-[10px] uppercase tracking-wide rounded bg-emerald-50 text-emerald-800 px-1.5 py-0.5">
                  {row.publisher}
                </span>
              )}
            </div>
            <div className="text-xs text-muted font-mono mt-0.5">{row.id}</div>
            {row.description && (
              <p className="text-xs text-muted-strong mt-1.5">{row.description}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {row.provides.map((cap) => (
                <span
                  key={cap}
                  className="rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5"
                >
                  {cap}
                </span>
              ))}
              {(row.dependsOn ?? []).map((dep, i) => {
                const d = dep as unknown as {
                  moduleId?: string;
                  capability?: string;
                  optional?: boolean;
                };
                const label = d.moduleId
                  ? `→ ${d.moduleId}`
                  : d.capability
                    ? `↘ ${d.capability}`
                    : String(dep);
                return (
                  <span
                    key={i}
                    className="rounded bg-blue-50 text-blue-700 px-1.5 py-0.5"
                  >
                    {label}
                    {d.optional ? " (optional)" : ""}
                  </span>
                );
              })}
            </div>
            <div className="mt-2 text-[11px] text-muted">
              {row.toolsCount} tool{row.toolsCount === 1 ? "" : "s"} ·{" "}
              {row.skillsCount} skill{row.skillsCount === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {primary}
          <SecondaryMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            row={row}
            onDetails={() => {
              setMenuOpen(false);
              onDetails();
            }}
            onDeletePackage={() => {
              setMenuOpen(false);
              void doDeletePackage(false);
            }}
            disabled={busy !== null}
          />
        </div>
      </div>
    </div>
  );
}

function pickIcon(kind: ModulePackageInfo["kind"] | null) {
  if (kind === "connector") return Plug;
  if (kind === "module") return AppWindow;
  if (kind === "hybrid") return AppWindow;
  return Package;
}

function pickKindLabel(
  kind: ModulePackageInfo["kind"] | null,
  reg: ModuleInfo | null,
): string | null {
  if (kind === "connector") return "Connector";
  if (kind === "module") return "App";
  if (kind === "hybrid") return "App + Connector";
  // Best-effort inference from registry's `provides`. Pure marketing —
  // doesn't drive behavior.
  if (reg && reg.provides?.length) return "App";
  return null;
}

function renderStateBadge(state: CardState) {
  switch (state) {
    case "installed":
      return (
        <span className="text-[10px] uppercase tracking-wide rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5">
          Installed
        </span>
      );
    case "update-available":
      return (
        <span className="text-[10px] uppercase tracking-wide rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">
          Update available
        </span>
      );
    case "available":
      return (
        <span className="text-[10px] uppercase tracking-wide rounded bg-bg-warm text-text-secondary border border-border px-1.5 py-0.5">
          Available
        </span>
      );
    case "orphaned":
      return (
        <span className="text-[10px] uppercase tracking-wide rounded bg-red-100 text-red-800 px-1.5 py-0.5">
          Orphaned
        </span>
      );
  }
}

function renderPrimary(
  row: CardRow,
  busy: null | "install" | "uninstall" | "update" | "delete",
  handlers: {
    onInstall: () => void;
    onUninstall: () => void;
    onUpdate: () => void;
    onForceUninstall: () => void;
  },
) {
  if (busy)
    return (
      <Button size="sm" variant="secondary" disabled>
        <Loader2 className="w-3 h-3 animate-spin mr-1" />
        Working…
      </Button>
    );
  switch (row.state) {
    case "installed":
      return (
        <Button size="sm" variant="outline" onClick={handlers.onUninstall}>
          Uninstall
        </Button>
      );
    case "update-available":
      return (
        <Button size="sm" variant="primary" onClick={handlers.onUpdate}>
          Update
        </Button>
      );
    case "available":
      return (
        <Button size="sm" variant="primary" onClick={handlers.onInstall}>
          Install
        </Button>
      );
    case "orphaned":
      return (
        <Button size="sm" variant="destructive" onClick={handlers.onForceUninstall}>
          Force-uninstall
        </Button>
      );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Secondary actions menu — lightweight click-outside-to-close dropdown.
// We don't pull in Radix here because the menu has only three items
// and we want a tight implementation footprint.
// ─────────────────────────────────────────────────────────────────────

function SecondaryMenu({
  open,
  onOpenChange,
  row,
  onDetails,
  onDeletePackage,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  row: CardRow;
  onDetails: () => void;
  onDeletePackage: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className="p-1.5 rounded-md text-muted hover:bg-bg-warm hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="More actions"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-md border border-border bg-surface-raised shadow-md py-1">
          <button
            type="button"
            onClick={onDetails}
            className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-bg-warm"
          >
            Details
          </button>
          <Link
            to="/settings"
            onClick={() => onOpenChange(false)}
            className="block px-3 py-1.5 text-xs text-text hover:bg-bg-warm"
          >
            View tool calls
            <span className="block text-[10px] text-muted">
              Settings → Tool calls
            </span>
          </Link>
          {row.pkg && (
            <>
              <div className="my-1 border-t border-border-subtle" />
              <button
                type="button"
                onClick={onDeletePackage}
                className="w-full text-left px-3 py-1.5 text-xs text-red hover:bg-red/10"
              >
                Delete package
              </button>
            </>
          )}
          {row.isBuiltin && (
            <div className="px-3 py-1.5 text-[10px] text-muted">
              Built-in module — no package to delete.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Force-delete confirmation dialog (409 path)
// ─────────────────────────────────────────────────────────────────────

function ForceDeleteDialog({
  state,
  onClose,
  onConfirmed,
}: {
  state: { row: CardRow; tenants: string[]; message: string } | null;
  onClose: () => void;
  onConfirmed: (restartRecommended: boolean) => void;
}) {
  const client = useClient();
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const { row, tenants, message } = state;

  async function confirm() {
    setBusy(true);
    const t = toast.loading(`Force-deleting ${row.name}@${row.version}…`);
    try {
      const r = await client.deleteModulePackage(row.id, row.version, true);
      if (r.ok) {
        toast.success(
          `Deleted ${row.name}@${row.version} — uninstalled from ${tenants.length} tenant(s)`,
          { id: t },
        );
        onConfirmed(r.restartRecommended);
      } else {
        toast.error(r.error.message ?? `Delete failed (${r.error.code})`, { id: t });
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Force-uninstall and delete?</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <div className="text-xs text-muted-strong space-y-2">
          <div className="text-text font-medium">
            {tenants.length} tenant{tenants.length === 1 ? "" : "s"} affected:
          </div>
          <div className="max-h-32 overflow-y-auto rounded border border-border bg-bg-warm/40 p-2 font-mono text-[11px]">
            {tenants.map((t) => (
              <div key={t}>{t}</div>
            ))}
          </div>
          <p>
            This uninstalls the module for every tenant listed, then deletes the
            host-global package record and removes its files from disk.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                Working…
              </>
            ) : (
              "Force uninstall + delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Details modal — read-only view of the manifest + package row.
// ─────────────────────────────────────────────────────────────────────

function DetailsModal({
  row,
  onClose,
}: {
  row: CardRow | null;
  onClose: () => void;
}) {
  if (!row) return null;
  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {row.name}{" "}
            <span className="text-xs text-muted font-normal">
              v{row.version}
            </span>
          </DialogTitle>
          <DialogDescription>{row.description || row.id}</DialogDescription>
        </DialogHeader>
        <dl className="text-xs space-y-2">
          <Detail term="Module id" value={row.id} mono />
          <Detail term="Kind" value={pickKindLabel(row.kind, row.registry) ?? "—"} />
          <Detail
            term="Source"
            value={row.isBuiltin ? "Built-in (host-registered)" : "Uploaded (.hebbsmod)"}
          />
          {row.pkg && (
            <>
              <Detail term="Content hash" value={row.pkg.contentHash} mono truncate />
              <Detail
                term="Publisher"
                value={row.publisher ?? "unsigned (dev mode)"}
              />
              <Detail term="Store path" value={row.pkg.storePath} mono truncate />
              <Detail
                term="Uploaded"
                value={new Date(row.pkg.uploadedAt).toLocaleString()}
              />
            </>
          )}
          {row.provides.length > 0 && (
            <Detail term="Provides" value={row.provides.join(", ")} />
          )}
          {row.dependsOn.length > 0 && (
            <Detail
              term="Depends on"
              value={row.dependsOn
                .map((d) => {
                  const dd = d as unknown as {
                    moduleId?: string;
                    capability?: string;
                    optional?: boolean;
                  };
                  const base =
                    dd.moduleId ?? dd.capability ?? JSON.stringify(d);
                  return dd.optional ? `${base} (optional)` : base;
                })
                .join(", ")}
            />
          )}
          {row.installedVersion && (
            <Detail
              term="Installed version"
              value={`v${row.installedVersion}`}
            />
          )}
        </dl>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  term,
  value,
  mono,
  truncate,
}: {
  term: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-muted">{term}</dt>
      <dd
        className={`flex-1 ${mono ? "font-mono" : ""} ${
          truncate ? "truncate" : ""
        } text-text`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Banners + empty state
// ─────────────────────────────────────────────────────────────────────

function RestartBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 px-4 py-2 flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="flex-1 text-xs">
        <div className="font-medium">Restart recommended</div>
        <div className="text-amber-800/90">
          A module was uninstalled or deleted. Node ESM can't fully unload the
          old code from memory until the host process restarts. New invocations
          may keep the previous handlers cached — see{" "}
          <code className="font-mono">docs/install-flow.md §5.3</code>.
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="p-1 rounded hover:bg-amber-100 text-amber-700"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function EmptyModulesState({ onPickFile }: { onPickFile: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
      <div className="text-sm font-medium text-text">No modules yet</div>
      <p className="text-xs text-muted mt-1 max-w-md mx-auto">
        Upload a <code className="font-mono">.hebbsmod</code> bundle to add
        connectors and apps. See BUILD-A-MODULE.md for the packaging guide and{" "}
        <code className="font-mono">pnpm pack-modules</code> to produce a
        bundle from a workspace package.
      </p>
      <div className="mt-4">
        <Button variant="primary" size="sm" onClick={onPickFile}>
          <UploadIcon className="w-3.5 h-3.5 mr-1" />
          Choose a .hebbsmod
        </Button>
      </div>
      <div className="mt-2">
        <a
          href="https://github.com/hebbs-inc/boringos-framework/blob/main/BUILD-A-MODULE.md"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent hover:underline"
        >
          Read the module guide
        </a>
      </div>
    </div>
  );
}

// Public legacy export for compatibility — Browse.tsx and
// InstallFromUrl.tsx are now unused but intentionally left in place
// (per task brief) until this rebuild is verified end-to-end.
