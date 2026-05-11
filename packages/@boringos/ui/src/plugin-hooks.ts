// SPDX-License-Identifier: MIT
//
// Hooks the plugin runtime needs:
//
//   useTool(name, input)        — typed tool dispatch via /api/tools/<name>
//   useInstalledModules()       — set of moduleIds installed for current tenant
//   useInstallModule()          — mutation to POST /modules/:id/install
//   useUninstallModule()        — mutation to POST /modules/:id/uninstall
//   useRealtimeEvent(type, fn)  — subscribe to SSE-broadcast events
//
// Plugins use these instead of rolling their own fetch + auth.

import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useClient } from "./provider.js";

// ─────────────────────────────────────────────────────────────────
// Tool dispatch
// ─────────────────────────────────────────────────────────────────

export interface ToolError {
  code: string;
  message: string;
  retryable?: boolean;
}

interface ToolEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: ToolError;
}

/**
 * React Query hook that dispatches a tool and caches the result.
 *
 *   const { data, isLoading, refetch } = useTool<{ data: Contact[] }>(
 *     "crm.contacts.list", { search }
 *   );
 */
export function useTool<T = unknown>(
  name: string,
  input: unknown,
  options: { enabled?: boolean; refetchInterval?: number } = {},
) {
  const client = useClient();
  return useQuery<T>({
    queryKey: ["tool", name, input],
    queryFn: () => client.invokeTool<T>(name, input),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });
}

/** Mutation variant — for tools called on user action (create/update/delete/dispatch). */
export function useToolMutation<TInput = unknown, TResult = unknown>(name: string) {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: (input: TInput) => client.invokeTool<TResult>(name, input),
    onSuccess: () => {
      // By convention, mutating tools invalidate their list-shaped sibling.
      const prefix = name.replace(/\.[^.]+$/, ".list");
      qc.invalidateQueries({ queryKey: ["tool", prefix] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Install state — per-tenant
// ─────────────────────────────────────────────────────────────────

/** Set of moduleIds installed for the current tenant. SSE-invalidated.
 * Keyed on `client.tenantId` so a post-login client identity change
 * causes a fresh fetch (instead of returning the cached pre-auth
 * empty result). */
export function useInstalledModules(): Set<string> {
  const client = useClient();
  const { data } = useQuery({
    queryKey: ["installs", client.tenantId ?? null],
    queryFn: () => client.getInstalls(),
    staleTime: 30_000,
    enabled: !!client.tenantId,
  });
  return new Set((data ?? []).map((r) => r.moduleId));
}

/**
 * Like `useInstalledModules` but also exposes the loading state so
 * callers can avoid acting on an empty (loading) set as if nothing
 * is installed. Used by `<RequireInstall>` to suppress the redirect
 * until the first fetch completes.
 */
export function useInstalledModulesState(): { installed: Set<string>; isLoading: boolean } {
  const client = useClient();
  const { data, isLoading } = useQuery({
    queryKey: ["installs", client.tenantId ?? null],
    queryFn: () => client.getInstalls(),
    staleTime: 30_000,
    enabled: !!client.tenantId,
  });
  return {
    installed: new Set((data ?? []).map((r) => r.moduleId)),
    // Treat "no tenantId yet" as still loading — avoids the
    // RequireInstall redirect race during the auth resolve.
    isLoading: isLoading || !client.tenantId,
  };
}

export function useInstallModule() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; hookError?: string }, Error, string>({
    mutationFn: (moduleId: string) => client.installModule(moduleId),
    // Invalidate broadly — partial keys match any ["installs", *].
    onSuccess: () => qc.invalidateQueries({ queryKey: ["installs"] }),
  });
}

export function useUninstallModule() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; hookError?: string }, Error, string>({
    mutationFn: (moduleId: string) => client.uninstallModule(moduleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["installs"] }),
  });
}

// ─────────────────────────────────────────────────────────────────
// Realtime events (SSE)
//
// Subscribes via the BoringOSClient.subscribe() method which handles
// the framework's existing auth (X-API-Key + tenantId query params)
// against /api/events. Each event is `{ type, tenantId, data, timestamp }`.
// ─────────────────────────────────────────────────────────────────

export function useRealtimeEvent(
  type: string,
  handler: (event: { type: string; data: Record<string, unknown> }) => void,
) {
  const client = useClient();
  const hRef = useRef(handler);
  hRef.current = handler;

  useEffect(() => {
    const unsubscribe = client.subscribe((event) => {
      if (event.type === type) hRef.current(event);
    });
    return () => unsubscribe();
  }, [client, type]);
}

/**
 * Convenience: invalidate `["installs"]` whenever a
 * module:installed / module:uninstalled event arrives. Mount once
 * near the shell root so the whole app gets live updates.
 */
export function useInstallEventSync() {
  const qc = useQueryClient();
  useRealtimeEvent("module:installed", () => {
    qc.invalidateQueries({ queryKey: ["installs"] });
  });
  useRealtimeEvent("module:uninstalled", () => {
    qc.invalidateQueries({ queryKey: ["installs"] });
  });
}
