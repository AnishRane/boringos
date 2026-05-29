# MDK upgrade guide — module authors

> If you're shipping a Hebbs module, read this when bumping
> `@boringos/module-sdk` across a major (or any minor that ships a
> renamed / removed type). For a single change, the relevant section
> below tells you what to do; for a multi-version jump, walk the
> sections in order.

This guide is **the authoritative reference** for module-side
migrations. Anything not described here is either an internal
host detail (you can ignore it) or a regression (file an issue on
`hebbs-ai/boringos`).

## How to use this guide

1. Look up the SDK version you're on (`npm view @boringos/module-sdk
   version`) and your target.
2. Walk each `## SDK x.y.z` heading between them in order.
3. Each heading lists: **renames**, **removed APIs**, **new APIs you
   should adopt**, and a one-line codemod / search-and-replace if
   the change has one.
4. Run `pnpm hebbs doctor <module-path>` after bumping. The doctor
   surfaces stale pins, deprecated imports, and `link:` / `workspace:`
   deps. `hebbs codemod <module> --codemod <id> --write` applies the
   automated fixes.

---

## SDK 0.13.0 (current)

### New: declarative `inboxSource` field (MDK T7.3)

```ts
inboxSource?: {
  eventType: string;
  filter?: { path: string; equals: unknown };
  map: {
    source: InboxField;
    subject: InboxField;
    body?: InboxField;
    from?: InboxField;
    assigneeUserId?: InboxField;
  };
}
```

The manifest-side equivalent of `app.routeToInbox(...)`. Runtime
`.hebbsmod` modules MUST use this field (they can't smuggle host
closures). Strings starting with `$.` are JSONPath-lite references
into the event payload; everything else is literal. See `MODULES.md`
→ "Hook reach" for the full policy table.

### No breaking changes from 0.12.0.

---

## SDK 0.12.0

### New: `__seed_meta` upgrade policy (MDK T7.2)

Optional `seedId` field on `AgentSeed`, `WorkflowSeed`, and `Routine`.
Defaults to `name` / `title` / `id`. Set explicitly when you might
rename a seed across versions and still want the upgrade thread to
follow the same row.

```ts
agents: [
  {
    seedId: "lead-triager-v1",
    name: "Lead Triager",
    persona: "personas-default.email-lens",
  },
],
```

No required action on existing modules — names are stable, the
default `seedId = name` keeps existing installs working.

---

## SDK 0.11.0

### New: `Lifecycle.seed` helper + declarative auto-seed (MDK T7.1)

The framework now auto-seeds manifest-level `agents` / `workflows` /
`routines` after `onInstall`. For seeds that need preconditions
(specific runtime id, custom `reportsTo` chain), use
`Lifecycle.seed`:

```ts
import { Lifecycle } from "@boringos/module-sdk";

lifecycle: {
  async onInstall(ctx) {
    const runtimeId = await pickClaudeRuntime(ctx);
    if (!runtimeId) return;
    await Lifecycle.seed(ctx, {
      agents: [{ name: "Lead Triager", persona: "email-lens" }],
      workflows: [...],
      routines: [...],
      custom: async () => seedPipelineFor(ctx),
    });
  },
},
```

The seed entries follow `(tenantId, source_app_id = <module-id>, name)`
for agents and `(tenantId, type = module:<id>, name)` for workflows.
Idempotent — re-running honours `__seed_meta` upgrade rules.

#### Migration: imperative SQL → `Lifecycle.seed`

If your module currently uses raw `INSERT INTO agents (...)`,
replace with a `Lifecycle.seed` call. Authors who did this manually:

1. Remove your own `fetchRootAgentId` / `fetchRuntimeId` — the
   framework handles both.
2. Remove pre-install scrub-then-insert dances. The hash-based
   dedupe replaces them.
3. Keep workflow / routine inserts for now if they need
   agent-id references; a richer `SeedResult` is on the roadmap.

See CRM `lifecycle.ts` (`hebbs-ai/hebbs-crm@9528a7e`) for a worked
example.

---

## SDK 0.10.0

### New: capability `provides` resolution

Built-in `@boringos/connector-google` advertises `email-send`,
`email-read`, `calendar`, `google-drive`, `google-contacts`.
`@boringos/connector-slack` advertises `chat-send`, `chat-read`,
`slack`. Use `dependsOn: [{ capability: "email-send" }]` instead of
hard-coding `dependsOn: [{ moduleId: "google" }]` so the host can
pick the best provider.

```ts
dependsOn: [{ capability: "email-send" }],
```

`hebbs dev` shows the OAuth walkthrough URL when a capability dep
isn't connected yet for the dev tenant (MDK T6.4).

---

## SDK 0.4.0 — `PluginUI` migration (deprecated `ModuleUI`)

`ModuleUI` (with symbolic component names) is deprecated. Author the
UI as a separate web package exporting `<id>UI: PluginUI` from
`@boringos/ui`. Declare `ui.entry` + `ui.sourcePath` in `module.json`
so `pack-hebbsmod` bundles it.

### Codemod

```sh
pnpm hebbs codemod path/to/your-module --codemod module-ui-to-plugin-ui --write
```

Renames `ModuleUI` → `PluginUI` imports + references. Restructuring
the slot data (moving from `module.ui.screens` to top-level
`navItems` / `entityPanels` etc.) is still a manual pass — see
`BUILD-A-MODULE.md`.

---

## Doctor

After any bump, run:

```sh
pnpm hebbs doctor path/to/your-module
```

It surfaces:

- `missing-module-sdk` — `@boringos/module-sdk` not in dependencies.
- `stale-module-sdk` — SDK pin below the current floor.
- `non-versioned-dep` — `link:` / `workspace:` / `file:` specs.
- `deprecated-module-ui` — `ModuleUI` import still present (use the codemod above).

CI: `hebbs doctor <module> --json` produces a machine-readable
report; exit 1 when errors are present.

---

## Stuck?

- The MDK plan + per-task progress lives in
  `hebbs-ai/boringos#50`.
- Reference implementation: `hebbs-ai/hebbs-crm` (it's the canonical
  example of a third-party module — same conventions you should
  follow).
- Doc you're reading is enforced by the `MDK Checklist` workflow:
  any PR that changes `module-sdk/src/types.ts` must update this
  file.
