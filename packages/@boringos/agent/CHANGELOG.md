# @boringos/agent

## 1.0.0

### Major Changes

- dc748a4: Host-wide runtime selection via `BORINGOS_RUNTIME` env var; deprecates per-tenant `runtimes` table + per-agent `runtime_id`.

  **Breaking change.** Runtime is now a single host-level config — the operator deploys the framework with one agentic CLI installed + authed (Pi / Claude Code / Codex / Gemini / Ollama / …) and sets `BORINGOS_RUNTIME=<name>` in the env. Defaults to `pi`. Optional `BORINGOS_MODEL=<model>` overrides the runtime's default model; per-agent `agents.model` still wins when set.

  What changed:

  - `@boringos/agent` — engine no longer reads `agents.runtime_id` to resolve which CLI to spawn. Reads `process.env.BORINGOS_RUNTIME` once at wake-time and resolves the adapter directly. The `runtimes` table is never queried. `install-manager.runSeed` inserts agents with `runtime_id = null`.
  - `@boringos/core` — `/api/auth/signup` no longer auto-seeds 6 runtime rows. The boot-time backfill that creates Chief of Staff + Copilot no longer requires a runtime row. The `runtimes` table is vestigial; existing rows are ignored.
  - `@boringos/dev-host` — drops its lookup of a tenant runtime; the dev-host agent is created with `runtime_id = null` (it only mints a callback JWT, never spawns a CLI).

  Operator migration:

  1. Install the CLI you want on the host (`npm install -g pi` / `claude` / `gemini` / etc.) and complete its login flow.
  2. Set `BORINGOS_RUNTIME=pi` (or your choice) in the framework process env.
  3. Restart. Existing agents with non-null `runtime_id` continue to work — engine ignores the column.

  Cleanup (optional but recommended to prevent stale assumptions): `DELETE FROM runtimes;` and `UPDATE agents SET runtime_id = NULL, fallback_runtime_id = NULL;`. Schema columns stay nullable for backward compat; a future major drops them.

  Module author impact: `AgentSeed.runtime` was discussed but never landed — not needed. `Lifecycle.seed` is unchanged; framework inserts the agent without a runtime ref. Author skill files (`SKILL.md`) should stop assuming per-agent runtime selection.

## 0.4.0

### Minor Changes

- 8594055: `__seed_meta` cleanup on uninstall + dangling-target recovery (MDK T8.3).

  - `installManager.uninstall()` now deletes `__seed_meta` rows for the (tenant, module) pair before dropping the install row. Without this, a subsequent re-install saw stale meta with dangling `target_id` and skipped re-seeding rows the uninstall just cleared.
  - `runSeed` now handles the dangling-target branch by dropping the stale meta row and falling through to first-time-seed semantics. Covers the CRM-style `scrubCrmSeeds` pattern where rows get cleared but meta needs to be regenerated.

## 0.3.1

### Patch Changes

- Updated dependencies [a53e6f4]
  - @boringos/module-sdk@0.13.0

## 0.3.0

### Minor Changes

- d1695e0: Seed upgrade policy via `__seed_meta` + content hashes (MDK T7.2).

  - `@boringos/db` — new `__seed_meta` table (and Drizzle export) tracking every framework-seeded agent / workflow / routine per tenant. Columns: `tenant_id`, `module_id`, `kind`, `seed_id`, `target_id`, `baseline_hash`, `module_version`. Unique on `(tenant_id, module_id, kind, seed_id)`; secondary index on `target_id` for reverse lookups.
  - `@boringos/module-sdk` — `AgentSeed`, `WorkflowSeed`, and `Routine` gain optional `seedId` (defaults to name / title / id) so authors can rename a seed without losing the upgrade thread.
  - `@boringos/agent` — `runSeed` now compares the current row's canonical-JSON hash against `__seed_meta.baseline_hash` to decide what to do on re-install:
    - Hash matches baseline AND payload changed → update the row + bump the meta.
    - Hash matches baseline AND payload unchanged → skip (no churn).
    - Hash differs from baseline → tenant edited; skip and leave their edit alone.
  - The "modified_since_install" check is implicit: no extra column on the seed target. The framework compares hashes at re-install time, so tenant edits via any path (admin API, manual SQL, future tools) are honoured without the framework having to remember to set a flag.

  Acceptance test (`tests/seed-upgrade-policy.test.ts`): tenant edits a routine, author bumps the seed, the tenant's edit survives. Companion test: untouched routine gets upgraded.

### Patch Changes

- Updated dependencies [d1695e0]
  - @boringos/module-sdk@0.12.0
  - @boringos/db@0.2.0
  - @boringos/drive@0.1.10

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
