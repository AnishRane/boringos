---
"@boringos/hebbs-cli": minor
---

`hebbs doctor <module>` — health-check a module package (MDK T7.4).

Five checks today:
- `missing-module-sdk` — error if `@boringos/module-sdk` isn't in `dependencies`.
- `stale-module-sdk` — warn if pinned below the current MDK SDK floor (0.11.0).
- `non-versioned-dep` — error on any `link:` / `workspace:` / `file:` dep so authors don't accidentally ship a bundle that only resolves on their machine.
- `deprecated-module-ui` — scan `src/**` for `ModuleUI` imports from `@boringos/module-sdk` (deprecated since T3.2) and emit a migration warning with file + line.
- Happy path returns `ok: true` with no findings.

CLI: `hebbs doctor <module-path>` prints findings with severity icons + file references; `--json` emits a machine-readable report. Exit 0 when no errors, 1 otherwise.

Programmatic API: `runDoctor({ modulePath, currentSdkVersion? })` from `@boringos/hebbs-cli`. T7.5 will layer codemod-driven auto-fixes on the same finding codes.
