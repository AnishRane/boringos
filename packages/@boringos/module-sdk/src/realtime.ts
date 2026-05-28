// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T3.1b — minimal `RealtimeBus` contract for `ModuleFactoryDeps`.
//
// The concrete realtime bus lives in `@boringos/core` (driven by an
// EventEmitter under the hood, fanned out to per-tenant SSE channels).
// Modules only call `.publish()` to fire run/task/workflow/module
// lifecycle events at the shell — the wider subscribe/subscribeAll
// surface is host-side. This file declares the narrow `publish`-only
// interface modules see via `ModuleFactoryDeps.realtimeBus`, breaking
// the would-be `module-sdk → @boringos/core` import cycle while
// letting core's concrete class implement it structurally.
//
// The `RealtimeEvent` shape is intentionally identical to the one in
// `@boringos/core/src/realtime.ts` so passing events through is a
// no-op for callers. Adding a new event type in core does not break
// the SDK contract — `type` is a plain `string`.

export interface RealtimeEvent {
  /** Discriminator the shell uses to route renderers — e.g.
   *  `run:completed`, `task:updated`, `module:installed`. */
  type: string;
  /** Tenant the event is scoped to — the SSE bus fans out per tenant. */
  tenantId: string;
  /** Free-form payload the shell consumes. */
  data: Record<string, unknown>;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

/**
 * The narrow surface of the realtime bus module factories see.
 * Modules only `publish`; subscription is the host's concern.
 */
export interface RealtimeBus {
  publish(event: RealtimeEvent): void;
}
