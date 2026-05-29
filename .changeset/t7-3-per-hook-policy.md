---
"@boringos/module-sdk": minor
"@boringos/core": minor
---

Per-hook runtime policy + declarative `inboxSource` (MDK T7.3).

- `@boringos/module-sdk` — new `InboxSource` type. `Module.inboxSource` is the manifest-level equivalent of `app.routeToInbox(...)`, with a JSONPath-lite field projection so `.hebbsmod` modules can declare inbox routing without smuggling closures.
- `@boringos/core` — `registerModule()` compiles a manifest `inboxSource` into the existing `inboxRoutes` pipeline. Same downstream behaviour as `app.routeToInbox()`; the helper handles event-type matching, optional path-equals filtering, and `$.` references into the event payload.
- `MODULES.md` — new "Hook reach" section codifying the policy table: tools/skills/schema/agents/workflows/routines/events/webhooks/inboxSource/lifecycle ship in the manifest; blockHandler is data-driven; contextProvider/persona/onTenantCreated/route stay host-only (and `route` is **explicitly disallowed** for runtime `.hebbsmod` — modules can't smuggle host-scope HTTP). Includes a worked `inboxSource` example.

CRM has no `routeToInbox` call to migrate today — it reacts to inbox events via routine triggers instead. The manifest field ships for future authors + the third-party `.hebbsmod` path.
