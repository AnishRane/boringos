# Build a Module — quickstart

> **Status:** Working starter. For canonical field-by-field
> reference see [`MODULES.md`](MODULES.md), [`TOOLS.md`](TOOLS.md),
> and [`SKILLS.md`](SKILLS.md). This file is the practical
> minimum.

This file teaches you to write a Module — the universal
component shape for everything the agent can see and do. A
Module is a manifest of skills + tools the agent can read and
call. The framework wires the rest.

---

## What you need

- TypeScript / Node 22+
- `pnpm install` at the repo root
- Be on the framework's main branch

---

## The minimal Module

A Module manifest is a plain object. Here's the smallest possible
one:

```typescript
import { z } from "@boringos/module-sdk";
import type { Module } from "@boringos/module-sdk";

export const helloModule: Module = {
  id: "hello",
  name: "Hello",
  version: "0.1.0",
  description: "Demo module — one tool, one skill",

  skills: [
    {
      id: "hello",
      source: "module",
      body: "Use `hello.greet` to greet someone by name. " +
            "It's a no-op example — useful for verifying " +
            "your prompt sees modules.",
    },
  ],

  tools: [
    {
      name: "greet",
      description: "Greet someone by name",
      inputs: z.object({ name: z.string() }),
      async handler({ name }) {
        return { ok: true, result: { greeting: `hello, ${name}` } };
      },
    },
  ],
};
```

Register it on a BoringOS host:

```typescript
import { BoringOS } from "@boringos/core";
import { helloModule } from "./hello-module.js";

const app = new BoringOS({});
app.module(helloModule);
await app.listen(3000);
```

That's it. The agent's prompt now includes:

- A `## Skills` section with the `### hello` block
- A `## Available tools` section listing `hello.greet`

The agent can call it with:

```bash
curl -X POST http://localhost:3000/api/tools/hello.greet \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "world"}'

# {"ok": true, "result": {"greeting": "hello, world"}}
```

---

## When to use a `ModuleFactory` instead

The inline form above works when your Module doesn't need access
to framework services (DB, memory provider, etc.). When you do,
pass a factory function instead — the framework calls it after
boot with the deps:

```typescript
import type { ModuleFactory } from "@boringos/module-sdk";
import type { Db } from "@boringos/db";

export const myCrmModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;

  return {
    id: "my-crm",
    name: "My CRM",
    version: "0.1.0",
    description: "...",
    tools: [
      {
        name: "list_deals",
        description: "List all deals for the tenant",
        inputs: z.object({}),
        async handler(_input, ctx) {
          const rows = await db
            .select()
            .from(/* your schema */)
            .where(/* tenantId = ctx.tenantId */);
          return { ok: true, result: { deals: rows } };
        },
      },
    ],
  };
};

// Register it the same way:
app.module(myCrmModule);
```

`ModuleFactoryDeps` exposes `db`, `memory`, `drive`, `engine`,
`workflowEngine`. Cast to your concrete types.

---

## Anatomy of a Tool

```typescript
{
  name: "create_deal",            // local name; full URL becomes <module>.create_deal
  description: "Create a deal",   // shown to the agent in the catalog
  inputs: z.object({              // Zod schema — validated before handler runs
    contactId: z.string().uuid(),
    amount: z.number().positive(),
    stage: z.enum(["new", "qualified", "won", "lost"]).optional(),
  }),
  output: z.object({              // optional — output schema for return values
    dealId: z.string(),
  }),
  async handler(input, ctx) {     // input is z.infer<typeof inputs>; ctx is ToolContext
    // ctx.tenantId, ctx.agentId, ctx.runId, ctx.taskId, ctx.invokedBy

    if (/* business rule fails */) {
      return {
        ok: false,
        error: {
          code: "invalid_input",
          message: "Contact does not exist",
          retryable: false,
        },
      };
    }

    const dealId = await /* do the work */;
    return { ok: true, result: { dealId } };
  },
}
```

### Error model

Tools return either `{ ok: true, result }` or `{ ok: false, error }`.

`error.code` is one of:
- `invalid_input` — schema validation failed (the framework returns this automatically when Zod rejects)
- `not_found` — referenced entity doesn't exist
- `permission_denied` — caller can't do this
- `upstream_unavailable` — 3rd-party API is down or misbehaving
- `rate_limited` — caller exceeded a quota
- `conflict` — concurrent write conflict
- `internal` — handler threw an uncaught error (the framework converts these and returns 500)

`error.retryable` tells the agent whether to retry. The framework
SKILL teaches the agent the retry policy.

### What the dispatcher does for you

Before your handler runs:
- Verifies the JWT (agent calls only — internal callers skip this)
- Looks up the tool by full name; 404 if missing
- Validates inputs against your Zod schema; 400 if invalid

After your handler returns:
- Wraps the result in the right HTTP status (200 for ok or business error, 500 for thrown)
- Writes a `tool_calls` audit row (tenant, tool, inputs, result, duration, status)

You write business logic. The framework handles the rest.

---

## Anatomy of a Skill

A Skill is markdown injected into the agent's prompt. Today they
live as inline `Skill` objects on the Module manifest. In Phase 6+
they move to literal `SKILL.md` files in your package, with
frontmatter for metadata.

```typescript
{
  id: "crm",                      // unique within the module
  source: "module",               // how it was loaded — "module" for in-package
  body: `Use the CRM tools to ... [markdown content]`,
  priority: 100,                  // ordering in the prompt; lower = earlier
  appliesTo: (event) =>           // optional gating
    event.agentRole === "sales-rep",
  requires: ["crm.list_deals"],   // (future) flag drift if this tool is missing
}
```

Priority ranges:
- `50` — framework-level (tool-protocol, approvals, when-stuck)
- `60-90` — module-shipped skills
- `200+` — agent persona / instructions
- `400` — tenant override

Lower priority appears EARLIER in the prompt. Higher priority
appears closer to the task — more influence on agent behavior.

---

## Testing your Module

```typescript
import { describe, it, expect } from "vitest";
import { createToolRegistry, dispatch } from "@boringos/agent";
import { z } from "@boringos/module-sdk";
import { helloModule } from "./hello-module.js";

describe("hello module", () => {
  it("greets via the dispatcher", async () => {
    const tools = createToolRegistry();
    for (const tool of helloModule.tools ?? []) {
      tools.register(helloModule.id, tool);
    }

    const out = await dispatch(
      { registry: tools },
      "hello.greet",
      { name: "world" },
      {
        tenantId: "t1",
        agentId: "a1",
        runId: "r1",
        invokedBy: "agent",
      },
    );

    expect(out.status).toBe(200);
    expect(out.result.ok).toBe(true);
    expect(out.result.result.greeting).toBe("hello, world");
  });
});
```

For HTTP-level testing, see the existing patterns in
`tests/http.test.ts and tests/framework-module.test.ts.

---

## What's NOT in this starter

The full Module manifest supports much more than what's shown
above. Below is the eight-dimensional surface — items marked with
🔜 ship in later phases of `task_12`:

| Field | Status |
|---|---|
| `skills` | ✅ inline; 🔜 SKILL.md files in Phase 6 |
| `tools` | ✅ |
| `dependsOn` / `provides` | 🔜 Phase 9 (capability resolution) |
| `schema` (Drizzle migrations, prefixed `<id>__`) | 🔜 Phase 8 (CRM port) |
| `ui` (screens, panels, settings) | 🔜 Phase 10 |
| `workflows` (default seeded) | 🔜 Phase 9 |
| `agents` (default seeded) | 🔜 Phase 9 |
| `routines` (cron / event / webhook) | 🔜 Phase 9 |
| `webhooks` (inbound HTTP) | 🔜 Phase 7 connector polish |
| `oauth` | 🔜 Phase 7 connector polish |
| `lifecycle.{onInstall, onUninstall, onTenantCreate}` | 🔜 Phase 5 polish |

---

## Next steps after this guide

1. Read [`docs/blockers/task_12_greenfield_rebuild.md`](docs/blockers/task_12_greenfield_rebuild.md)
   end-to-end if you'll be authoring or porting Modules.
2. Look at `packages/@boringos/core/src/modules/framework.ts`
   for a complete real Module — 9 tools, 3 skills, full DB
   integration.
3. The other built-ins (`memory.ts`, `drive.ts`, `workflow.ts`,
   `inbox.ts`) are tighter examples of single-purpose modules.
4. The CRM port (`task_12` Phase 8) will be the first hybrid
   Module exercising every dimension — schema, UI, default
   workflows, default agents. That's the canonical guide
   `task_13` rewrites this file around.

---

## Declaring `kind`

Optional metadata field on the Module manifest. Used for UI
grouping only — dispatch, install, and uninstall behave
identically regardless of value.

```typescript
export const crmModule: Module = {
  id: "crm",
  name: "Hebbs CRM",
  version: "0.3.0",
  kind: "hybrid",   // "connector" | "module" | "hybrid"
  // ...
};
```

| `kind`        | Owns data? | OAuth? | Examples                |
|---------------|------------|--------|-------------------------|
| `"connector"` | rarely     | yes    | Gmail, Slack            |
| `"module"`    | yes        | no     | Hebbs CRM, Triage       |
| `"hybrid"`    | yes        | yes    | Stripe Billing, HubSpot |

If you omit `kind`, the framework infers it via
`inferModuleKind(mod)` (exported from `@boringos/module-sdk`):
`oauth && !schema → "connector"`, `schema && !oauth → "module"`,
both present → `"hybrid"`, neither → `"module"`. Declare it
explicitly when the inference is wrong for your module — e.g. a
connector that happens to ship a cache table.

The shell groups `"connector"` modules under **Connectors** and
the other two under **Apps**.

---

## How to ship — packaging a `.hebbsmod`

Once your Module compiles, you ship it as a single
`.hebbsmod` file. Admins drop that file onto the Apps screen and
tenants click Install. No npm publish, no source checkout, no
host restart.

The canonical spec for the bundle, the install lifecycle, and
the HTTP surface lives in
[`docs/install-flow.md`](docs/install-flow.md). This section is
the practical "how do I cut a build" version.

### The bundle format

`<id>-<version>.hebbsmod` is a renamed zip. Internal layout:

```
crm-0.3.0.hebbsmod
├── module.json       # static manifest (see below)
├── index.mjs         # bundled ESM, default export = Module | ModuleFactory
├── skills/           # SKILL.md files referenced from manifest
│   └── deals.md
├── migrations/       # optional, Drizzle SQL — applied per-tenant
│   └── 0001_initial.sql
├── ui/               # optional, prebuilt assets for the shell
│   ├── index.mjs
│   └── assets/...
└── signature         # optional Ed25519 over (module.json + index.mjs + ui/index.mjs)
```

Bundles are **self-contained** — esbuild inlines everything
except `@boringos/*` (provided by the host). See
[`docs/install-flow.md`](docs/install-flow.md) §1 for the full
spec including signing and content-addressing.

### `module.json` — the static manifest

The host reads `module.json` *before* importing your code so it
can render the install preview without executing anything. It's
a strict subset of the runtime `Module` interface — only the
discovery-time fields:

```json
{
  "id": "crm",
  "name": "Hebbs CRM",
  "version": "0.3.0",
  "description": "Deals, contacts, pipelines",
  "kind": "hybrid",
  "entry": "./index.mjs",
  "ui": { "entry": "./ui/index.mjs" },
  "dependsOn": [{ "capability": "email-send", "optional": true }],
  "provides": ["crm-source"],
  "permissions": { "defaultRoles": ["admin", "member"] },
  "publisher": { "id": "hebbs", "name": "Hebbs" },
  "license": "MIT",
  "minFrameworkVersion": "1.0.0"
}
```

The full Module — tools, skills, schema, lifecycle hooks — is
the **default export** of `index.mjs`. After import, the host
validates that the runtime export's `id` and `version` match
`module.json` exactly. Mismatches are rejected at upload time.

### Pack it

Two paths. Pick whichever fits your workflow.

**Per-module** — from inside the module's package directory
after `pnpm build`:

```bash
cd packages/@boringos/module-crm
pnpm build
pnpm exec pack-hebbsmod
# → dist/crm-0.3.0.hebbsmod
# → SHA-256: 3f9c1e... (printed to stdout)
```

**All modules at once** — from the framework root:

```bash
pnpm pack:modules
# Walks every registered standalone module package and packs
# each. Same output: <pkg>/dist/<id>-<version>.hebbsmod plus a
# SHA-256 line per bundle.
```

Both paths compute and print the SHA-256 of the output bytes.
The framework content-addresses uploads by that hash — two
uploads of the same `.hebbsmod` are deduped.

### Upload + install

Two paths again. Same backend.

**UI:** open the shell's **Apps** screen as an admin, drag the
`.hebbsmod` onto the drop zone, review the parsed manifest in
the preview pane, click **Confirm**. The module appears as
"Available" host-wide. Then click **Install** on a tenant's
card to apply it for that tenant.

**API:** the same flow as two `curl`s:

```bash
# Upload (LAYER 1 + 2 — host-global, register runtime)
curl -F file=@dist/crm-0.3.0.hebbsmod \
  -H "X-API-Key: $BORINGOS_API_KEY" \
  http://localhost:3030/api/admin/modules/upload

# Install for the current tenant (LAYER 3)
curl -X POST \
  -H "X-API-Key: $BORINGOS_API_KEY" \
  http://localhost:3030/api/admin/modules/crm/install
```

### What happens on the host

The three layers run in order. Failure at any layer rolls back
the layers above it.

- **LAYER 1 — Package store.** Framework extracts the zip to
  `MODULES_STORE_DIR/<id>@<version>/`, validates the manifest
  + signature, inserts a `module_packages` row keyed by
  `(id, version, contentHash)`, then dynamically imports
  `index.mjs`.
- **LAYER 2 — Runtime registration.** The imported Module is
  fed through the same `app.module()` pipeline used at boot.
  Tools land in the ToolRegistry, skills in the SkillRegistry,
  webhooks mount at `/api/webhooks/<id>/*`, UI mounts at
  `/modules/<id>/ui/*`.
- **LAYER 3 — Per-tenant install.** When an admin clicks
  **Install** for a tenant, the InstallManager runs
  `schema` migrations into `<id>__*` tables, fires
  `lifecycle.onInstall(ctx)` to seed default workflows /
  agents / routines, and inserts a `module_installs` row.

### Uninstall + delete

Two halves, mirroring install:

- **Per-tenant uninstall** drops only the tenant's data and
  `module_installs` row. LAYER 1 + 2 stay in place — other
  tenants keep using the module.
- **Host-global delete** removes the `module_packages` row,
  unmounts the runtime, and deletes the extracted store
  directory:

  ```bash
  curl -X DELETE \
    -H "X-API-Key: $BORINGOS_API_KEY" \
    "http://localhost:3030/api/admin/modules/crm?version=0.3.0"
  ```

  The framework refuses delete if any tenant still has the
  module installed. Pass `force=true` to override (drops every
  tenant's install in one shot — destructive).

### Re-install requires re-upload

There is no `pnpm reload`, no hot-swap, no in-place patch.
If you change anything — code, schema, skills, UI — bump the
version in `module.json`, run `pnpm pack:modules`, upload the
new `.hebbsmod`. The host carries multiple versions in
`module_packages`; per-tenant `module_installs` rows pin to a
specific version. That's the whole point of the design — every
running module is byte-identical to a file you can put in
source control.

## Signing modules

Production hosts reject unsigned `.hebbsmod` uploads. Dev hosts
set `HEBBS_DEV_MODULES=true` to accept them with a warning.

1. **Generate a publisher keypair** (once per organization):

   ```bash
   npx sign-hebbsmod --gen-key
   ```

   Stash the private key somewhere secret. Copy the public half
   into the host's trust list.

2. **Trust your key on the host.** Either drop a file at
   `<repo-root>/.data/module-publishers.json`:

   ```json
   [
     { "id": "your-org", "name": "Your Org", "publicKey": "<public-hex>" }
   ]
   ```

   …or set `HEBBS_MODULE_PUBLISHERS` to the same JSON inline.
   The env var takes precedence.

3. **Sign your bundle** after `pnpm pack:modules`:

   ```bash
   npx sign-hebbsmod \
     --pkg ./dist/crm-0.3.0.hebbsmod \
     --key "$HEBBS_PRIVATE_KEY" \
     --publisher-id your-org
   ```

   The CLI rewrites the zip with `signature` (raw 64-byte Ed25519)
   and `signature.meta.json` (`{ publisherId, algorithm }`) added.

The framework signs the concat of `module.json` + `index.mjs`
+ `ui/index.mjs` (if present). Any byte-level change after
signing — even a re-zip — invalidates the signature.
