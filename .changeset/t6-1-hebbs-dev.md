---
"@boringos/hebbs-cli": minor
---

Add `hebbs dev <module>` — boots a headless host against the module and keeps it alive (Ctrl+C to stop), printing the URL, tenant id, callback JWT, and a ready-to-paste `curl` example. Mirrors `hebbs test` for arguments (`--tool` / `--inputs`) but never tears down on its own. Programmatic API: `startDev()` from `@boringos/hebbs-cli`. MDK T6.1. Hot-reload via file watcher lands in T6.2.
