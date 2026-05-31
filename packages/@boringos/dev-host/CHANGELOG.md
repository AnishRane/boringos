# @boringos/dev-host

## 0.6.2

### Patch Changes

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

- Updated dependencies [6f6786e]
  - @boringos/db@1.0.0
  - @boringos/core@2.0.0
  - @boringos/agent@1.2.0
  - @boringos/module-sdk@1.0.0

## 0.6.1

### Patch Changes

- Updated dependencies [2715428]
  - @boringos/agent@1.1.0
  - @boringos/core@1.0.1

## 0.6.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [dc748a4]
  - @boringos/agent@1.0.0
  - @boringos/core@1.0.0

## 0.5.4

### Patch Changes

- Updated dependencies [8594055]
  - @boringos/agent@0.4.0
  - @boringos/core@0.4.1

## 0.5.3

### Patch Changes

- Updated dependencies [a53e6f4]
  - @boringos/module-sdk@0.13.0
  - @boringos/core@0.4.0
  - @boringos/agent@0.3.1

## 0.5.2

### Patch Changes

- Updated dependencies [d1695e0]
  - @boringos/module-sdk@0.12.0
  - @boringos/db@0.2.0
  - @boringos/agent@0.3.0
  - @boringos/core@0.3.2

## 0.5.1

### Patch Changes

- Updated dependencies [0fe25a1]
  - @boringos/module-sdk@0.11.0
  - @boringos/agent@0.2.0
  - @boringos/core@0.3.1

## 0.5.0

### Minor Changes

- 610c3c8: Connector OAuth walkthrough for `hebbs dev` (MDK T6.4, scaffolding).

  - `@boringos/core` — built-in Google and Slack connector modules now declare `provides` so `dependsOn: [{ capability }]` resolves cleanly. Google provides `email-send`, `email-read`, `calendar`, `google-drive`, `google-contacts`. Slack provides `chat-send`, `chat-read`, `slack`.
  - `@boringos/dev-host` — new `DevHost.getAuthSteps()` returns `AuthStep[]` for every unmet capability dependency of the module under test. Each step carries the resolving connector module id, the OAuth `authorizeUrl` (preconfigured with `tenantId` + the provider's scopes), and a human-readable reason string. Pulls the registered modules from `app.boundModules` and the existing connection state from `connector_accounts`, so already-connected providers don't generate noise.
  - `@boringos/hebbs-cli` — `startDev()` eagerly computes auth steps and surfaces them on `DevHandle.authSteps`. `hebbs dev` prints a `⚠ N connector accounts not yet connected:` block listing each step's capability → provider → URL → scopes after the boot banner. `getAuthSteps()` errors don't fail the boot.

  **Live OAuth acceptance** — paste the URL into a browser, complete Google consent, see `connector_accounts` written, dispatch a tool that uses the token — is deferred behind a STOP/ASK on #50 (needs Parag's Google OAuth client_id/secret + a registered redirect URI). The walkthrough machinery is verified end-to-end against a fixture module that declares `dependsOn: [{ capability: "email-send" }]`.

### Patch Changes

- Updated dependencies [610c3c8]
  - @boringos/core@0.3.0

## 0.4.0

### Minor Changes

- 5df7340: `recipes/docker/` Compose recipe + `hebbs dev --postgres-url` (MDK T6.3, scope-down).

  - New `recipes/docker/docker-compose.yml` — Postgres 16 on `127.0.0.1:5439`, named volume `hebbs-dev-pgdata`, healthchecked. The "wp-env-equivalent" for module authors who want persistent state across `hebbs dev` restarts or are hitting macOS `kern.sysv.shmmni` shm limits with the embedded default.
  - `recipes/docker/README.md` — quickstart, when-to-use guidance, lifecycle commands, and a roadmap note pointing at the deferred full `hebbs dev --docker` flag.
  - `DevHostOptions.databaseUrl` — opt out of embedded Postgres and point at an external instance. Migrations still run on boot.
  - `hebbs dev --postgres-url <url>` (or `$DATABASE_URL`) — surfaces the same option through the CLI. The boot summary now shows `postgres: embedded | external`.

  The full `hebbs dev --docker` flag (orchestrates this Compose file + a containerised Shell+Core) is **deferred** — it requires `@boringos/shell` to ship as a published OCI image, which is a separate piece of work.

## 0.3.0

### Minor Changes

- 8700a8c: Hot reload for `hebbs dev` (MDK T6.2).

  - `DevHost.reload()` — drops the currently-registered module and re-imports + re-registers from the original path. Uses a `?t=<token>` cache-buster so Node's ESM cache hands back the new code, and (for `.hebbsmod` archives) re-extracts into a sibling dir each time. Returns `{ toolsRemoved/Added, skillsRemoved/Added, moduleVersion, durationMs }`. `DevHost.moduleVersion` is now a getter so reload-time version bumps land in the handle.
  - `hebbs dev` arms an `fs.watch(modulePath, { recursive: true })` watcher when given a directory (skipped automatically for `.hebbsmod` archives; opt out with `--no-watch`). Edits debounce 250ms, then trigger `reload()`. CLI prints `↻ reloaded <id>@<ver> (tools R→A, skills R→A, Nms)` after each successful reload.
  - Programmatic API: `startDev({ modulePath, watch: "auto" | true | false, watchDebounceMs, onReload, onReloadError })` — `DevHandle.watching` reports whether a watcher is armed.
  - File events from `node_modules/`, `.git/`, swap files (`*~`, `*.swp`), and non-source extensions are filtered before the debounce.
  - Reload errors don't crash the host; they print to stderr (or surface via `onReloadError`) and the watcher stays armed.

## 0.2.0

### Minor Changes

- 94e73b7: New package `@boringos/dev-host` — a reusable headless harness that boots BoringOS with all built-ins, registers a `.hebbsmod` (or a pre-built module package), seeds a tenant, mints a callback JWT, and exposes a `dispatch(toolName, inputs)` helper plus direct DB access for assertions. The single `createDevHost({ modulePath })` call replaces the bespoke `scripts/try-runtime-install.mjs` orchestration — future `hebbs test` and CI acceptance scripts consume this entrypoint. MDK T4.1.
