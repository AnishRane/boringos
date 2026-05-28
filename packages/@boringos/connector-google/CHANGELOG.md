# @boringos/connector-google

## 0.2.0

### Minor Changes

- 3d6eb97: BREAKING (0.x): removed legacy `executeAction`-based `GmailClient` and `CalendarClient` classes. Use typed methods (`listMessages`, `sendEmail`, `listEvents`, `createEvent`, etc.) instead. The exports now point to what was previously `GmailClientV2`/`CalendarClientV2`. Following 0.x semver, this breaking change is a minor bump. Token-provider constructor and typed methods are documented in the package README and skill files.

### Patch Changes

- Updated dependencies [42ea1e7]
  - @boringos/module-sdk@0.2.0

## 0.1.1

### Patch Changes

- Agent templates, team templates (5 built-in), hierarchy (org tree, delegation, escalation), workflow-triggered routines, wake-agent and connector-action block handlers.
- Updated dependencies
  - @boringos/shared@0.1.1
  - @boringos/connector@0.1.1

## 0.1.0

### Minor Changes

- Initial release of BoringOS — the framework that takes away all the boring parts of building agentic platforms.

### Patch Changes

- Updated dependencies
  - @boringos/shared@0.1.0
  - @boringos/connector@0.1.0
