# @boringos/hebbs-cli

## 0.3.0

### Minor Changes

- 98fa7bf: Add `hebbs dev <module>` — boots a headless host against the module and keeps it alive (Ctrl+C to stop), printing the URL, tenant id, callback JWT, and a ready-to-paste `curl` example. Mirrors `hebbs test` for arguments (`--tool` / `--inputs`) but never tears down on its own. Programmatic API: `startDev()` from `@boringos/hebbs-cli`. MDK T6.1. Hot-reload via file watcher lands in T6.2.

## 0.2.0

### Minor Changes

- 5305c60: New package `@boringos/hebbs-cli` — the Hebbs CLI. Initial command: `hebbs test <module>` boots a headless host (via `@boringos/dev-host`) against a `.hebbsmod` archive or a built module package directory, optionally dispatches one smoke tool (`--tool <fq-name> --inputs '<json>'`), and emits either a human summary or `--json` for machine consumers. Exit code 0 on success, 1 on failure. MDK T4.2.
