---
"@boringos/module-sdk": minor
---

Extract a narrow `RealtimeBus` interface (just `publish(event)`) plus the `RealtimeEvent` shape into `@boringos/module-sdk`; type `ModuleFactoryDeps.realtimeBus` with it. Replaces the pre-MDK `unknown` cast pattern and fixes the doc-comment drift (the old comment said "emit" — the method is actually `publish`). `@boringos/core`'s concrete realtime bus implements the new interface structurally; no behaviour change. MDK T3.1b.
