# @boringos/shell

## 0.1.0

### Minor Changes

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
  - @boringos/ui@1.0.0

## 0.0.3

### Patch Changes

- Updated dependencies
  - @boringos/ui@0.1.9

## 0.0.2

### Patch Changes

- First publish to npm. Ships the built Vite bundle under `dist/` (consume via static hosting, not `import`).
