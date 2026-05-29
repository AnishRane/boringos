---
"@boringos/agent": major
"@boringos/core": major
"@boringos/dev-host": minor
---

Host-wide runtime selection via `BORINGOS_RUNTIME` env var; deprecates per-tenant `runtimes` table + per-agent `runtime_id`.

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
