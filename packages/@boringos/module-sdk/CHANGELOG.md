# @boringos/module-sdk

## 0.5.0

### Minor Changes

- 299ccc3: Add `ManifestSchema` (a zod schema for `module.json`) and helpers `parseManifest`, `compareSemver`, `checkMinFrameworkVersion`, plus the `MODULE_ID_RE` / `SEMVER_RE` constants (MDK T2.2). Replaces the ad-hoc field-by-field validation that lived inside `pack-hebbsmod`. Third-party scaffolders and the host install-manager now have a single typed entry point for `module.json` validation, including the `minFrameworkVersion` install-time compatibility gate.

## 0.4.0

### Minor Changes

- bed93db: `pack-hebbsmod` now derives the bundled `module.json` from the Module factory at pack time (MDK T2.1). Runtime fields (`id`, `name`, `version`, `description`, `kind`, `dependsOn`, `provides`, `defaultInstall`) come from the factory's returned Module; pack-time-only fields (`entry`, `ui`, `publisher`, `license`, `minFrameworkVersion`) come from the on-disk static `module.json` unchanged. Drift between the two is logged on stdout. Exports a new `mergeManifest(static, runtime)` helper for callers who need the merge logic standalone.

## 0.3.0

### Minor Changes

- a4ca940: Add `requiredScopes: ScopeDefinition[]` to `ConnectorDefinition` (closes the `profileService` hidden-service hack in `@boringos/connector-google`). `AuthManager.startOAuthFlow` now merges connector-required identity scopes with caller-requested service scopes (deduped) so any `ConnectorDefinition` can declare always-on OAuth scopes without piggybacking on the services flattener. `googleConnector` switches from `services: [profileService, …]` to `requiredScopes: PROFILE_SCOPES`; the `profileService` export is removed (it had no external consumers). Backward compatible: existing connectors without `requiredScopes` behave identically. Closes the `profileService` API-shape bullet in #61 (MDK Phase 0, T0.1 in `plans/module-dev-kit.md`).

### Patch Changes

- 97d205a: Hoist the tool result payload convention into `TOOLS.md` and `module-sdk/README.md` as a first-class rule (list-style tools return a named-key object keyed by the plural resource; singular tools return the value directly). Closes the "Tool result shape convention" bullet in #61. Pure documentation — no API or runtime changes.

## 0.2.0

### Minor Changes

- 42ea1e7: Add ConnectorDefinition, ServiceDefinition, AuthStrategy, ScopeDefinition, ConnectedAccount, ConnectorTokenHandle, ScopeCheckResult types. Extend ModuleFactoryDeps with optional listConnectedAccounts and checkScopes methods. Add optional advisory connectors field to Module manifest. All changes are additive.
