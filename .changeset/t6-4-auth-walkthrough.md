---
"@boringos/dev-host": minor
"@boringos/hebbs-cli": minor
"@boringos/core": minor
---

Connector OAuth walkthrough for `hebbs dev` (MDK T6.4, scaffolding).

- `@boringos/core` — built-in Google and Slack connector modules now declare `provides` so `dependsOn: [{ capability }]` resolves cleanly. Google provides `email-send`, `email-read`, `calendar`, `google-drive`, `google-contacts`. Slack provides `chat-send`, `chat-read`, `slack`.
- `@boringos/dev-host` — new `DevHost.getAuthSteps()` returns `AuthStep[]` for every unmet capability dependency of the module under test. Each step carries the resolving connector module id, the OAuth `authorizeUrl` (preconfigured with `tenantId` + the provider's scopes), and a human-readable reason string. Pulls the registered modules from `app.boundModules` and the existing connection state from `connector_accounts`, so already-connected providers don't generate noise.
- `@boringos/hebbs-cli` — `startDev()` eagerly computes auth steps and surfaces them on `DevHandle.authSteps`. `hebbs dev` prints a `⚠ N connector accounts not yet connected:` block listing each step's capability → provider → URL → scopes after the boot banner. `getAuthSteps()` errors don't fail the boot.

**Live OAuth acceptance** — paste the URL into a browser, complete Google consent, see `connector_accounts` written, dispatch a tool that uses the token — is deferred behind a STOP/ASK on #50 (needs Parag's Google OAuth client_id/secret + a registered redirect URI). The walkthrough machinery is verified end-to-end against a fixture module that declares `dependsOn: [{ capability: "email-send" }]`.
