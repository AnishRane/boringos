---
"@boringos/module-sdk": minor
---

Extract a narrow `ToolRegistry` interface (`get` / `list` / `listByModule`) plus `RegisteredTool` into `@boringos/module-sdk`; type `ModuleFactoryDeps.toolRegistry` with it. Replaces the pre-MDK `unknown` cast pattern. The agent's concrete `ToolRegistry` in `@boringos/agent` keeps the wider `register` / `unregisterModule` / `listByCapability` surface for host-side use and structurally implements the SDK's read-only view. Completes the T3.1 sub-task ladder (`memory`, `drive`, `realtimeBus`, `eventBus`, `toolRegistry` now all typed). MDK T3.1d.
