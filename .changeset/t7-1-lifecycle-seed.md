---
"@boringos/module-sdk": minor
"@boringos/agent": minor
---

Lifecycle.seed + declarative auto-seed (MDK T7.1).

- `@boringos/module-sdk` — new `Lifecycle.seed(ctx, { agents, workflows, routines, custom })` helper. Authors call it from `onInstall` when seeding needs preconditions (e.g. a fetched runtime id, a `reportsTo` chain). `ModuleContext` gains an optional `seed` method the framework provisions; calling `Lifecycle.seed` outside a lifecycle hook throws cleanly. New types: `SeedPayload`, `SeedResult`, `SeedFn`, `LifecycleContext`.
- `@boringos/agent` — install-manager auto-seeds the manifest-level `agents` / `workflows` / `routines` collections after `onInstall` returns, and again on `onTenantCreated`. Idempotency keys: agents `(tenantId, source_app_id=<id>, name)` (with `source='app'` to satisfy `agents_source_app_id_check`); workflows `(tenantId, type='module:<id>', name)`; routines `(tenantId, title)`. Seeded agents default `reportsTo` to the tenant's existing root so the `agents_tenant_one_root_idx` unique stays satisfied. Routine non-cron triggers are skipped for now — T7.3 wires event/webhook routines via the inbox-source / events surfaces.
- `MODULES.md` — new "Seeding agents / workflows / routines" section covering both paths with a worked example.

CRM still ships its own seeder. T8.3 moves CRM onto this helper.
