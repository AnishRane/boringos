# @boringos/hebbs-cli

## 0.5.0

### Minor Changes

- 5df7340: `recipes/docker/` Compose recipe + `hebbs dev --postgres-url` (MDK T6.3, scope-down).

  - New `recipes/docker/docker-compose.yml` — Postgres 16 on `127.0.0.1:5439`, named volume `hebbs-dev-pgdata`, healthchecked. The "wp-env-equivalent" for module authors who want persistent state across `hebbs dev` restarts or are hitting macOS `kern.sysv.shmmni` shm limits with the embedded default.
  - `recipes/docker/README.md` — quickstart, when-to-use guidance, lifecycle commands, and a roadmap note pointing at the deferred full `hebbs dev --docker` flag.
  - `DevHostOptions.databaseUrl` — opt out of embedded Postgres and point at an external instance. Migrations still run on boot.
  - `hebbs dev --postgres-url <url>` (or `$DATABASE_URL`) — surfaces the same option through the CLI. The boot summary now shows `postgres: embedded | external`.

  The full `hebbs dev --docker` flag (orchestrates this Compose file + a containerised Shell+Core) is **deferred** — it requires `@boringos/shell` to ship as a published OCI image, which is a separate piece of work.

### Patch Changes

- Updated dependencies [5df7340]
  - @boringos/dev-host@0.4.0

## 0.4.0

### Minor Changes

- 8700a8c: Hot reload for `hebbs dev` (MDK T6.2).

  - `DevHost.reload()` — drops the currently-registered module and re-imports + re-registers from the original path. Uses a `?t=<token>` cache-buster so Node's ESM cache hands back the new code, and (for `.hebbsmod` archives) re-extracts into a sibling dir each time. Returns `{ toolsRemoved/Added, skillsRemoved/Added, moduleVersion, durationMs }`. `DevHost.moduleVersion` is now a getter so reload-time version bumps land in the handle.
  - `hebbs dev` arms an `fs.watch(modulePath, { recursive: true })` watcher when given a directory (skipped automatically for `.hebbsmod` archives; opt out with `--no-watch`). Edits debounce 250ms, then trigger `reload()`. CLI prints `↻ reloaded <id>@<ver> (tools R→A, skills R→A, Nms)` after each successful reload.
  - Programmatic API: `startDev({ modulePath, watch: "auto" | true | false, watchDebounceMs, onReload, onReloadError })` — `DevHandle.watching` reports whether a watcher is armed.
  - File events from `node_modules/`, `.git/`, swap files (`*~`, `*.swp`), and non-source extensions are filtered before the debounce.
  - Reload errors don't crash the host; they print to stderr (or surface via `onReloadError`) and the watcher stays armed.

### Patch Changes

- Updated dependencies [8700a8c]
  - @boringos/dev-host@0.3.0

## 0.3.0

### Minor Changes

- 98fa7bf: Add `hebbs dev <module>` — boots a headless host against the module and keeps it alive (Ctrl+C to stop), printing the URL, tenant id, callback JWT, and a ready-to-paste `curl` example. Mirrors `hebbs test` for arguments (`--tool` / `--inputs`) but never tears down on its own. Programmatic API: `startDev()` from `@boringos/hebbs-cli`. MDK T6.1. Hot-reload via file watcher lands in T6.2.

## 0.2.0

### Minor Changes

- 5305c60: New package `@boringos/hebbs-cli` — the Hebbs CLI. Initial command: `hebbs test <module>` boots a headless host (via `@boringos/dev-host`) against a `.hebbsmod` archive or a built module package directory, optionally dispatches one smoke tool (`--tool <fq-name> --inputs '<json>'`), and emits either a human summary or `--json` for machine consumers. Exit code 0 on success, 1 on failure. MDK T4.2.
