# BoringOS — current state vs proposed rebuild

This is a working doc. Read top-down. The first half describes
what the framework does today, honestly. The second half describes
what it should be.

---

## What is currently happening

The framework grew by accretion. Each new capability invented its
own shape. The result is a system that works but has too many
concepts for what it does.

### The agent's system prompt is built from ~12 different shapes

Every wake, the framework runs a context pipeline that assembles
the agent's system prompt by walking ~12 providers, each with a
different shape:

| Provider | Where the content lives | Shape |
|---|---|---|
| `header` | Hand-written string in TS | Template literal |
| `persona` | Markdown bundles in `personas/<role>/*.md` | Disk files |
| `tenant-guidelines` | DB row | Text column |
| `agent-instructions` | DB row | Text column |
| `drive-skill` | TS function on `StorageBackend` | `skillMarkdown()` return value |
| `memory-skill` | TS function on `MemoryProvider` | `skillMarkdown()` return value |
| `approvals-skill` | Hand-written TS provider | Template literal |
| `chief-of-staff` | Hand-written TS provider | Template literal |
| `protocol` | Hand-written curl block in TS | Template literal |
| `hierarchy` | Generated from DB org tree | DB query → markdown |
| `api-catalog` | Strings registered via `agentDocs` | Function or string |
| `connector-actions-catalog` | Generated from `ConnectorRegistry` | Walks registry |

Twelve providers. Six different shapes for "markdown that ends up
in the prompt."

### "Things the agent can call" lives in three different places

| Source | How it's declared | How it's called by the agent |
|---|---|---|
| Connector action | `ConnectorDefinition.actions[]` | `POST /api/connectors/actions/<kind>/<action>` |
| App-mounted route | `app.route(path, hono, { agentDocs })` | Whatever path the app declared |
| Framework callback | Hand-written Hono routes in `routes.ts` | `POST /api/agent/...`, hand-curated curl examples |

Three URL patterns. Three registration patterns. Three failure
modes for drift between docs and handler. (We just fixed one of
them — A.1 — when the framework's PATCH endpoint silently dropped
fields the docs claimed it accepted.)

### Three different "skill" concepts coexist

1. **Function-form skill** — `connector.skillMarkdown()`,
   `runtime.skillMarkdown()`, `memory.skillMarkdown()`. Returns a
   string. Lives in TypeScript code in the component's package.
2. **Per-component provider** — `memory-skill`, `drive-skill`,
   `approvals-skill`, `chief-of-staff`, `protocol`. Hand-written
   markdown in `@boringos/agent`'s providers folder.
3. **Tenant-curated skill** — admin API at `/api/admin/skills`,
   synced from github / url, attached to agents, symlinked into
   the agent's working directory.

Same word, three implementations, three places content lives.

### Five "thing-that-runs-on-a-schedule" concepts

1. `BlockHandler` — the workflow engine's block types
2. `Routine` — cron-scheduled tool/agent calls
3. `Plugin.jobs` — plugin-defined cron jobs with state
4. `Plugin.webhooks` — inbound HTTP from 3rd parties
5. `app.onEvent(...)` — event subscriptions

Each has its own registry, its own DB shape, its own admin API.

### Tooling for connectors vs apps vs framework is parallel

A connector author defines: `oauth`, `events`, `actions`,
`createClient`, `handleWebhook`, `skillMarkdown`. Six fields.

An app author defines: `route(path, hono, { agentDocs })` calls,
plus optional `onTenantCreated`, `beforeStart`, `afterStart`,
`beforeShutdown`, `onEvent` lifecycle hooks. Different shape.

A plugin author defines: `name`, `version`, `jobs`, `webhooks`,
`state`. Different again.

The framework itself defines: hand-written Hono routes in
`routes.ts` and `admin-routes.ts`, plus the hand-curated curl
catalog in `protocol.ts`.

Four parallel registration styles. They produce overlapping
artifacts (skills + tools + schedules + webhooks) but you have to
learn each style to contribute to the framework in any of them.

### 17 DB tables, 6 API trees

API trees: `/api/agent/*`, `/api/admin/*`, `/api/copilot/*`,
`/api/connectors/actions/*`, `/api/auth/*`, `/api/events`,
`/webhooks/plugins/*`. Six trees, three different auth models
(JWT, API key, session token).

Tables: 17, of which a few are redundant (`approvals` was
collapsed into `tasks` via task_06; `agent_wakeup_requests` is
queue state masquerading as a table).

### Net effect

Adding a Slack connector today requires touching:
- `ConnectorDefinition` shape (actions, skillMarkdown, OAuth, …)
- A `connector-actions-catalog` provider that emits the actions
  into the agent's prompt
- Possibly the workflow engine if Slack triggers something

Adding an app like the CRM today requires:
- A separate codebase (today: `hebbs-clients/boringos-crm`)
- Hand-written Hono routes mounted via `app.route()`
- A custom `agentDocs` blob describing those routes
- Schema migrations the developer wires by hand

Adding a "prevent customer churn" feature today requires:
- Authoring a custom plugin with `jobs` + `webhooks` + `state`
- Or authoring a workflow with the workflow engine
- Plus a skill markdown blob somewhere the agent will read

**Three different developer experiences for "extend the framework."**

That's the gap.

---

## What I am proposing

Collapse every concept above into **two primitives the agent reads**
and **one shape every component takes**.

### Two primitives the agent reads

1. **Skills** — markdown that teaches the agent how to think.
   Ships as `SKILL.md` next to component code. One file shape,
   loaded into the prompt under `## Skills`.

2. **Tools** — callable operations with Zod-typed inputs. One
   registry, one URL pattern: `POST /api/tools/<module-id>.<name>`.
   Generated catalog shows the agent the inventory.

That is the **entire** prompt-side surface. No more "12 providers
in 6 shapes." No more "three places to register a callable." Skills
teach behavior; tools do work; everything else is plumbing.

### One shape every component takes — the Module

Connectors, apps, plugins, built-in subsystems (memory, drive,
approvals): all the same shape. They are all **Modules**.

```ts
type Module = {
  id: string;            // "google", "slack", "crm", "memory", "prevent-churn"
  name: string;
  version: string;
  dependsOn?: string[];  // other modules this one needs
  skills: SkillFile[];   // SKILL.md files this module ships
  tools: Tool[];         // operations the agent can call
  schema?: Migration[];  // DB tables the module owns
  routines?: Routine[];  // scheduled tool calls
  events?: EventSpec[];  // events the module emits
  webhooks?: Webhook[];  // inbound HTTP, scoped under /api/webhooks/<id>/...
  oauth?: OAuthConfig;   // if it brokers a 3rd party
};
```

One registration verb: `app.module(myModule)`. One install/uninstall
lifecycle. One way to discover what's loaded.

### Three honest roles a Module can play

The Module shape is universal, but in practice modules fall into
three roles. Same shape, different fields populated:

| Role | Owns | Examples |
|---|---|---|
| **Connector module** | OAuth + API client + raw 3rd-party tools | `slack`, `gmail`, `salesforce`, `stripe` |
| **Capability module** | Business logic + maybe own schema, depends on connectors | `prevent-churn`, `lead-scoring`, `deal-forecasting` |
| **Hybrid module** | Own schema + own logic + optional 3rd-party integration | `crm` (Hebbs's), `inbox` |

A connector module owns OAuth and exposes raw API verbs as tools.
A capability module declares `dependsOn: ["salesforce", "gmail"]`
and composes those connectors' tools into business logic. A hybrid
module owns its own data and may or may not talk to 3rd parties.

You install Salesforce (connector) once. You can then install many
capability modules — `prevent-churn`, `pipeline-health` — that
share Salesforce's credentials and tools. The framework refuses to
install a capability whose deps aren't satisfied.

### The agent's contract, restated

The agent receives a task with a conversation thread. The system
prompt contains its persona's skill, the skills of every module
loaded for the tenant, and the inventory of every tool it can
call. The agent reasons. It calls tools. It posts comments. **Side
effects happen only through tools.** Continuity happens only
through the per-task session. When stuck, it hands the task back
to a user. When done, status=done.

There's no other API for the agent to learn — no separate
connector endpoints, no separate app routes, no hand-curated curl
block. Just SKILL.md + tools.

---

## Side-by-side: the deltas

| Today | Tomorrow |
|---|---|
| 12 context providers, 6 shapes | 1 skills provider + 1 tool-catalog provider + 5 per-run-context providers (task / comments / session / memory-context / approval) |
| 3 places to register "things to call" | 1 tool registry |
| 3 URL patterns for agent calls | 1: `POST /api/tools/<module-id>.<name>` |
| Connector / app / plugin / framework all parallel | One `Module` type, four roles |
| `skillMarkdown()` returning TS strings | `SKILL.md` files |
| Persona bundles + `instructions` column | Same content, but loaded through the skill registry like everything else |
| 6 API trees | 4 trees (`/api/auth`, `/api/admin`, `/api/tools`, `/api/webhooks/<module-id>`) |
| 17 tables | ~13 (drop redundant) |
| BlockHandler, Routine, Plugin.jobs, Plugin.webhooks, app.onEvent — five scheduling/event shapes | Routines target tools (or workflow tools); webhooks namespaced per module |
| Workflow engine as a separate runtime | Workflows are tools (`workflow.run`); the DAG is a tool that calls other tools |
| `protocol.ts` hand-curated curl block | Framework ships its own SKILL.md ("tool-protocol") |

---

## What stays (because it's already right)

- Per-task sessions (the `tasks.session_id` invariant — one Claude
  Code session per task)
- JWT-authed agent callbacks
- Default-deny approval posture (default-deny is a skill, not
  built-in)
- Approvals as tasks with `originKind: agent_action` (already
  collapsed in task_06)
- Per-tenant scoping (every table, every registry)
- Embedded Postgres + Drizzle (zero-config dev, opt-in external)
- Pluggable queue (in-process default, BullMQ opt-in)
- The core `tasks` / `agents` / `agent_runs` / `task_comments` /
  `task_work_products` schema
- CLI-as-runtime (Claude Code, Codex, Gemini — never an SDK call)
- Hebbs memory provider (becomes the memory Module)

---

## What this enables

- **Adding a new connector is one package.** Ship a Module with
  OAuth + tools + SKILL.md. Zero framework files touched.
- **A marketplace shape becomes possible.** Module is installable,
  versioned, scoped per tenant. Browse connectors, browse
  capabilities, install/uninstall.
- **Tenant customization is a registry override.** Override a
  SKILL.md, override a tool's handler, all in the same shape.
- **Tests collapse.** Mock the tool registry; assert tools were
  called with expected inputs.
- **The CRM stops being a separate codebase.** It becomes a hybrid
  module that registers like any other.
- **Versioning is a Module field.** Bump one number to ship.
- **Composability is explicit.** `dependsOn` makes the module
  graph a real artifact instead of folkloric coupling.

---

## What "perfect" means here — three tests

The rebuild is right if these all hold:

1. **Adding a connector requires touching zero framework files.**
   Ship a Module package, register it, done.
2. **The agent's prompt is reproducible from `(modules loaded for
   tenant) + (agent's role) + (current task)`.** No hand-curated
   providers, no special cases. Prompt becomes data, not code.
3. **Deleting a Module deletes everything it owned.** Skills
   disappear from prompt, tools disappear from catalog, routines
   stop, schema migrations roll back. One uninstall verb.

If those three hold, the framework is OS-shaped: install/uninstall
modules, agents run on them, the host orchestrates.

---

## Open questions before writing task_12

These are real decisions, not bikeshedding:

1. **Do we keep the workflow engine?** Position: yes, but rebuild
   it as a tool (`workflow.run`) whose blocks are other tools. No
   separate `BlockHandler` registry.
2. **Is the copilot a Module?** Position: yes — it's a built-in
   module shipping copilot tools + a copilot agent. Removes
   `/api/copilot/*` as a special tree.
3. **What about the existing admin skill system** (github sync,
   trust levels)? Position: keep, but rename to "tenant
   overrides." It's the third source for SKILL.md content
   (alongside packaged modules + per-agent instructions).
4. **Capability resolution**: do capability modules depend on
   *concrete* modules (`dependsOn: ["salesforce"]`) or on
   *capabilities* the modules announce (`dependsOn: ["crm-source"]`,
   any module that announces it provides `crm-source` qualifies)?
   Position: capabilities, with a `provides` field on the Module
   manifest. Lets capability modules work across CRM vendors.
5. **Migration path**: greenfield or graceful? The user signaled
   greenfield ("delete every data, just make it perfect"). Confirm
   before writing the task — greenfield is cheaper to implement
   but invalidates every existing tenant.
6. **CRM port scope**: rewrite the CRM as a v2 module from
   scratch, or port the existing `boringos-crm` codebase? The
   former is cleaner but bigger; the latter risks dragging accreted
   patterns forward.

---

## TL;DR

**Today:** ~12 context providers in 6 shapes, 3 places to register
callables, 4 parallel ways to author components (connector / app /
plugin / framework), 17 tables, 6 API trees.

**Tomorrow:** Skills + Tools (the agent's two prompt primitives) +
Modules (one universal shape for components, three honest roles).
Two primitives, one shape, one registration verb.

Same capability, much smaller surface, no drift between docs and
handlers, marketplace-ready, install/uninstall as a real verb.

That's the rebuild. Next step (after you sign off on this thesis):
write task_12, the concrete migration plan with file lists, schema
deletions, and module-by-module port order.
