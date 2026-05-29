---
"@boringos/module-sdk": minor
"@boringos/db": minor
"@boringos/agent": minor
---

Seed upgrade policy via `__seed_meta` + content hashes (MDK T7.2).

- `@boringos/db` — new `__seed_meta` table (and Drizzle export) tracking every framework-seeded agent / workflow / routine per tenant. Columns: `tenant_id`, `module_id`, `kind`, `seed_id`, `target_id`, `baseline_hash`, `module_version`. Unique on `(tenant_id, module_id, kind, seed_id)`; secondary index on `target_id` for reverse lookups.
- `@boringos/module-sdk` — `AgentSeed`, `WorkflowSeed`, and `Routine` gain optional `seedId` (defaults to name / title / id) so authors can rename a seed without losing the upgrade thread.
- `@boringos/agent` — `runSeed` now compares the current row's canonical-JSON hash against `__seed_meta.baseline_hash` to decide what to do on re-install:
  - Hash matches baseline AND payload changed → update the row + bump the meta.
  - Hash matches baseline AND payload unchanged → skip (no churn).
  - Hash differs from baseline → tenant edited; skip and leave their edit alone.
- The "modified_since_install" check is implicit: no extra column on the seed target. The framework compares hashes at re-install time, so tenant edits via any path (admin API, manual SQL, future tools) are honoured without the framework having to remember to set a flag.

Acceptance test (`tests/seed-upgrade-policy.test.ts`): tenant edits a routine, author bumps the seed, the tenant's edit survives. Companion test: untouched routine gets upgraded.
