# @boringos/agent

## 0.2.0

### Minor Changes

- 0fe25a1: Lifecycle.seed + declarative auto-seed (MDK T7.1).

  - `@boringos/module-sdk` — new `Lifecycle.seed(ctx, { agents, workflows, routines, custom })` helper. Authors call it from `onInstall` when seeding needs preconditions (e.g. a fetched runtime id, a `reportsTo` chain). `ModuleContext` gains an optional `seed` method the framework provisions; calling `Lifecycle.seed` outside a lifecycle hook throws cleanly. New types: `SeedPayload`, `SeedResult`, `SeedFn`, `LifecycleContext`.
  - `@boringos/agent` — install-manager auto-seeds the manifest-level `agents` / `workflows` / `routines` collections after `onInstall` returns, and again on `onTenantCreated`. Idempotency keys: agents `(tenantId, source_app_id=<id>, name)` (with `source='app'` to satisfy `agents_source_app_id_check`); workflows `(tenantId, type='module:<id>', name)`; routines `(tenantId, title)`. Seeded agents default `reportsTo` to the tenant's existing root so the `agents_tenant_one_root_idx` unique stays satisfied. Routine non-cron triggers are skipped for now — T7.3 wires event/webhook routines via the inbox-source / events surfaces.
  - `MODULES.md` — new "Seeding agents / workflows / routines" section covering both paths with a worked example.

  CRM still ships its own seeder. T8.3 moves CRM onto this helper.

### Patch Changes

- Updated dependencies [0fe25a1]
  - @boringos/module-sdk@0.11.0

## 0.1.17

### Patch Changes

- Updated dependencies [efba86b]
  - @boringos/module-sdk@0.10.0

## 0.1.16

### Patch Changes

- Updated dependencies [88c018d]
  - @boringos/module-sdk@0.9.0

## 0.1.15

### Patch Changes

- Updated dependencies [4a204a5]
  - @boringos/module-sdk@0.8.0

## 0.1.14

### Patch Changes

- Updated dependencies [09fb6b7]
  - @boringos/module-sdk@0.7.0

## 0.1.13

### Patch Changes

- Updated dependencies [097883c]
  - @boringos/module-sdk@0.6.0

## 0.1.12

### Patch Changes

- Updated dependencies [299ccc3]
  - @boringos/module-sdk@0.5.0

## 0.1.11

### Patch Changes

- Updated dependencies [bed93db]
  - @boringos/module-sdk@0.4.0

## 0.1.10

### Patch Changes

- Updated dependencies [a4ca940]
- Updated dependencies [97d205a]
- Updated dependencies
  - @boringos/module-sdk@0.3.0
  - @boringos/db@0.1.9
  - @boringos/runtime@0.1.9
  - @boringos/memory@0.1.9
  - @boringos/drive@0.1.9
  - @boringos/pipeline@0.1.9

## 0.1.9

### Patch Changes

- Updated dependencies [42ea1e7]
  - @boringos/module-sdk@0.2.0

## 0.1.1

### Patch Changes

- Agent templates, team templates (5 built-in), hierarchy (org tree, delegation, escalation), workflow-triggered routines, wake-agent and connector-action block handlers.
- Updated dependencies
  - @boringos/shared@0.1.1
  - @boringos/memory@0.1.1
  - @boringos/runtime@0.1.1
  - @boringos/drive@0.1.1
  - @boringos/db@0.1.2
  - @boringos/pipeline@0.1.1

## 0.1.0

### Minor Changes

- Initial release of BoringOS — the framework that takes away all the boring parts of building agentic platforms.

### Patch Changes

- Updated dependencies
  - @boringos/shared@0.1.0
  - @boringos/memory@0.1.0
  - @boringos/runtime@0.1.0
  - @boringos/drive@0.1.0
  - @boringos/db@0.1.0
  - @boringos/pipeline@0.1.0
