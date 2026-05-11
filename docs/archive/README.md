# Archive

Historical / superseded docs kept for context. Nothing here is
authoritative. For the current shape of the framework, start at
[`README.md`](../../README.md) → [`MODULES.md`](../../MODULES.md)
→ [`install-flow.md`](../install-flow.md).

## What's here

- **`v2/`** — design notes from the v1→v2 collapse session
  (`session-1-progress.md`).
- **`phases/`** — original 5-phase build plan. Phase 1 + 2 shipped;
  phases 3–5 were superseded by the Module collapse plan and the
  `docs/blockers/task_*` workstream.
- **`tests/`** — phase smoke-test result reports
  (`test_phase1.md`, `phase2-gate-results.md`,
  `test_phase3_n_workstream.md`, `test_today.md`). Reference for
  what was validated at each gate; not maintained.
- **`build/`** — `tasks-phase-{1,2,3}.json` work-tracking exports
  and the `way-to-implement.md` build playbook.
- **`migrate-existing-connectors.md`** — abandoned plan to migrate
  existing connectors to the v1 `@boringos/connector-sdk`. The
  migration that actually happened was the collapse to the Module
  shape.

The active blocker workstream lives at
[`docs/blockers/`](../blockers/); completed blockers are at
[`docs/blockers/done/`](../blockers/done/).
