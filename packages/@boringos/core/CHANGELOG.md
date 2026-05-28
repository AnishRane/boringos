# @boringos/core

## 0.1.12

### Patch Changes

- Updated dependencies [299ccc3]
  - @boringos/module-sdk@0.5.0
  - @boringos/agent@0.1.12
  - @boringos/connector-google@0.2.3
  - @boringos/connector-slack@0.2.3

## 0.1.11

### Patch Changes

- Updated dependencies [bed93db]
  - @boringos/module-sdk@0.4.0
  - @boringos/agent@0.1.11
  - @boringos/connector-google@0.2.2
  - @boringos/connector-slack@0.2.2

## 0.1.10

### Patch Changes

- a4ca940: Add `requiredScopes: ScopeDefinition[]` to `ConnectorDefinition` (closes the `profileService` hidden-service hack in `@boringos/connector-google`). `AuthManager.startOAuthFlow` now merges connector-required identity scopes with caller-requested service scopes (deduped) so any `ConnectorDefinition` can declare always-on OAuth scopes without piggybacking on the services flattener. `googleConnector` switches from `services: [profileService, …]` to `requiredScopes: PROFILE_SCOPES`; the `profileService` export is removed (it had no external consumers). Backward compatible: existing connectors without `requiredScopes` behave identically. Closes the `profileService` API-shape bullet in #61 (MDK Phase 0, T0.1 in `plans/module-dev-kit.md`).
- Updated dependencies [a4ca940]
- Updated dependencies [97d205a]
- Updated dependencies
  - @boringos/module-sdk@0.3.0
  - @boringos/connector-google@0.2.1
  - @boringos/db@0.1.9
  - @boringos/runtime@0.1.9
  - @boringos/memory@0.1.9
  - @boringos/drive@0.1.9
  - @boringos/pipeline@0.1.9
  - @boringos/agent@0.1.10
  - @boringos/connector-slack@0.2.1

## 0.1.9

### Patch Changes

- Updated dependencies [3d6eb97]
- Updated dependencies [42ea1e7]
- Updated dependencies [a1d8af9]
  - @boringos/connector-google@0.2.0
  - @boringos/module-sdk@0.2.0
  - @boringos/connector-slack@0.2.0
  - @boringos/agent@0.1.9

## 0.1.2

### Patch Changes

- Agent templates, team templates (5 built-in), hierarchy (org tree, delegation, escalation), workflow-triggered routines, wake-agent and connector-action block handlers.
- Updated dependencies
  - @boringos/shared@0.1.1
  - @boringos/memory@0.1.1
  - @boringos/runtime@0.1.1
  - @boringos/drive@0.1.1
  - @boringos/db@0.1.2
  - @boringos/agent@0.1.1
  - @boringos/workflow@0.1.2
  - @boringos/pipeline@0.1.1
  - @boringos/connector@0.1.1

## 0.1.0

### Minor Changes

- Initial release of BoringOS — the framework that takes away all the boring parts of building agentic platforms.

### Patch Changes

- Updated dependencies
  - @boringos/shared@0.1.0
  - @boringos/memory@0.1.0
  - @boringos/runtime@0.1.0
  - @boringos/drive@0.1.0
  - @boringos/db@0.1.0
  - @boringos/agent@0.1.0
  - @boringos/workflow@0.1.0
  - @boringos/pipeline@0.1.0
  - @boringos/connector@0.1.0
