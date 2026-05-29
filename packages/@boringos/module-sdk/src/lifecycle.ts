// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Lifecycle helpers exposed to module authors.
//
// MDK T7.1 — `Lifecycle.seed(ctx, { agents, workflows, routines, custom })`
// is the imperative path module authors call from their `onInstall`
// hook when seeding requires preconditions (e.g. fetch the tenant's
// Claude runtime id before seeding agents that need it).
//
// The complementary **declarative** path — declaring `agents`,
// `workflows`, `routines` on the Module manifest — is auto-seeded by
// the framework's install manager after `onInstall` returns. Authors
// who don't need preconditions never touch this helper. See
// `MODULES.md` for the full guidance.
//
// The implementation lives in `@boringos/agent`'s install manager,
// which provisions `ctx.seed` on the `ModuleContext` it passes to
// lifecycle hooks. This file is a thin facade so authors import a
// stable name from the SDK rather than reaching into the agent.

import type { AgentSeed, ModuleContext, Routine, WorkflowSeed } from "./types.js";

/**
 * The shape of work `Lifecycle.seed` accepts. Each list is
 * idempotent on (`tenantId`, `module:<id>`, `name`/`title`) — re-running
 * onInstall (or calling `seed` from a tool) won't duplicate rows. The
 * `custom` hook runs after the framework's seed inserts so authors
 * can wire references the declarative path doesn't cover.
 */
export interface SeedPayload {
  agents?: readonly AgentSeed[];
  workflows?: readonly WorkflowSeed[];
  routines?: readonly Routine[];
  /**
   * Free-form callback for seeding outside the framework's normal
   * tables (pipeline stages, connector profile rows, etc.). Runs
   * after the agent/workflow/routine inserts in the same install
   * transaction.
   */
  custom?: () => Promise<void>;
}

export interface SeedResult {
  /** Rows inserted (excludes skipped duplicates). */
  agentsSeeded: number;
  workflowsSeeded: number;
  routinesSeeded: number;
  /** Rows skipped because (tenantId, source, name) already existed. */
  agentsSkipped: number;
  workflowsSkipped: number;
  routinesSkipped: number;
}

/**
 * The framework provisions this on the `ModuleContext` passed to
 * lifecycle hooks. Modules invoke it via {@link Lifecycle.seed}.
 */
export type SeedFn = (payload: SeedPayload) => Promise<SeedResult>;

/**
 * Augmented context surface — the framework hands lifecycle hooks a
 * `ModuleContext` with `seed` attached. Authors don't construct this;
 * the type just makes `Lifecycle.seed(ctx, ...)` type-check without
 * forcing every reader of `ModuleContext` to know about the helper.
 */
export type LifecycleContext = ModuleContext & { seed?: SeedFn };

/**
 * Convenience namespace authors import from `@boringos/module-sdk`.
 *
 * ```ts
 * import { Lifecycle } from "@boringos/module-sdk";
 *
 * export const lifecycle: ModuleLifecycle = {
 *   async onInstall(ctx) {
 *     const runtimeId = await fetchClaudeRuntime(ctx);
 *     if (!runtimeId) return; // wait for next install attempt
 *     await Lifecycle.seed(ctx, {
 *       agents: [{ name: "Email Lens", persona: "personas-default.email-lens" }],
 *       workflows: [...],
 *       routines: [...],
 *       custom: async () => seedPipelineFor(ctx),
 *     });
 *   },
 * };
 * ```
 */
export const Lifecycle = {
  /**
   * Seed agents / workflows / routines for the calling tenant.
   * Idempotent — re-runs skip rows whose `(tenantId, source,
   * name/title)` already exists. Throws if invoked outside a
   * lifecycle hook (the framework provisions `ctx.seed`; if it's
   * missing the host hasn't wired it).
   */
  async seed(ctx: LifecycleContext, payload: SeedPayload): Promise<SeedResult> {
    if (typeof ctx.seed !== "function") {
      throw new Error(
        "Lifecycle.seed: ctx.seed not provisioned. Either you're calling seed " +
          "from somewhere other than a Module lifecycle hook, or the host " +
          "predates MDK T7.1. Upgrade the framework or move the call into " +
          "onInstall / onTenantCreate.",
      );
    }
    return ctx.seed(payload);
  },
};

export type { ModuleLifecycle } from "./types.js";
