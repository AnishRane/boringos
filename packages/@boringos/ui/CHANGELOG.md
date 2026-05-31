# @boringos/ui

## 1.0.0

### Major Changes

- 6f6786e: Remove the deprecated per-tenant runtime layer; runtime is host-wide via `BORINGOS_RUNTIME`.

  **Breaking:**

  - Dropped the `agents.runtime_id` / `agents.fallback_runtime_id` columns (idempotent migration). The `runtimes` table is retained as an empty, read-only backward-compat shim (no drizzle schema / API / UI) so existing `.hebbsmod` packages that still query it degrade gracefully; a future major may drop it.
  - Removed the `/api/admin/runtimes` CRUD endpoints and the agent `runtimeId` / `fallbackRuntimeId` fields on create/patch. Removed `getRuntimes`/`createRuntime`/`updateRuntime`/`deleteRuntime`/`setDefaultRuntime` and the `useRuntimes` hook from `@boringos/ui`, and `runtimeId`/`fallbackRuntimeId` from the `Agent` type.
  - Removed the runtime picker from the agent UI.

  **Kept / new:**

  - Per-agent model selection (`agents.model`) is unchanged. The model picker now sources options from the host runtime via the new `GET /api/admin/runtime/models`; `useRuntimeModels()` takes no argument.
  - Host-wide runtime config for `command`/`webhook` runtimes via the new `BORINGOS_RUNTIME_CONFIG` env (JSON), replacing the old per-tenant `runtimes.config`.
  - Claude now defaults to **Haiku** (`CLAUDE_DEFAULT_MODEL`) when no per-agent `agents.model` / `BORINGOS_MODEL` override is set.

  **Fixes:** drive_issues #13 — `inbox-triage` / `inbox-replier` no longer silently no-op on fresh tenants (they had gated install on a per-tenant `runtimes` row that never existed post-migration). Adds a fresh-tenant regression test.

### Patch Changes

- Updated dependencies [6f6786e]
  - @boringos/shared@1.0.0

## 0.1.9

### Patch Changes

- Republish baseline — closes the T1.4 blocker. Fixes two upstream publish bugs from the `b0897a8` chore release:

  1. Six packages (`db`, `runtime`, `ui`, `memory`, `drive`, `pipeline`) had unresolved `workspace:*` references in their published `0.1.8` tarballs' dependency lists. Republishing via `pnpm changeset publish` correctly converts those to concrete versions.
  2. `@boringos/ui@0.1.8` source contained `PluginUI` (the canonical UI contract type from Connector SDK v2) but the previously published tarball did not include the export. The patch republish ships it.

  No source-level API changes; this is purely a registry-hygiene catch-up so downstream modules (CRM) can install from npm cleanly.

## 0.1.1

### Patch Changes

- Agent templates, team templates (5 built-in), hierarchy (org tree, delegation, escalation), workflow-triggered routines, wake-agent and connector-action block handlers.
- Updated dependencies
  - @boringos/shared@0.1.1

## 0.1.0

### Minor Changes

- Initial release of BoringOS — the framework that takes away all the boring parts of building agentic platforms.

### Patch Changes

- Updated dependencies
  - @boringos/shared@0.1.0
