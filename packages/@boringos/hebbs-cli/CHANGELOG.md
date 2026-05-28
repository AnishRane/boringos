# @boringos/hebbs-cli

## 0.2.0

### Minor Changes

- 5305c60: New package `@boringos/hebbs-cli` — the Hebbs CLI. Initial command: `hebbs test <module>` boots a headless host (via `@boringos/dev-host`) against a `.hebbsmod` archive or a built module package directory, optionally dispatches one smoke tool (`--tool <fq-name> --inputs '<json>'`), and emits either a human summary or `--json` for machine consumers. Exit code 0 on success, 1 on failure. MDK T4.2.
