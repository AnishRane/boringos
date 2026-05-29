# @boringos/dev-host

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
