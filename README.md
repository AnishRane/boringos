# BoringOS

> The operating system for agents. You ship Modules; the agent
> reads skills and calls tools. Everything else is plumbing.

BoringOS is an open-source framework for building agentic
platforms — agents receive tasks, execute autonomously via CLI
subprocesses (Claude Code, Codex, Gemini CLI, Ollama, …), and
report back. The framework never calls LLM APIs directly; CLIs
are the agents, BoringOS is the orchestrator.

---

## The two primitives

The agent's prompt is built from two registries, sourced from
plain data — no hand-written providers per integration.

- **Skills** — markdown files (`SKILL.md`) shipped by every
  component. Loaded into the agent's prompt under `## Skills`.
  Teach the agent how to think about a domain.
- **Tools** — Zod-typed callable operations. Registered by
  Modules, dispatched at one URL: `POST /api/tools/<module>.<tool>`.
  The agent reads an inventory, calls them, gets validated
  responses with structured errors.

## The one shape

A **Module** bundles skills + tools + (optionally) schema, UI,
default workflows, default agents, routines, OAuth, and webhooks.
Three roles, same shape:

- **Connector** — brokers a 3rd-party API (`connector-google`,
  `connector-slack`)
- **Capability** — pure logic depending on other Modules
  (`triage`, `prevent-churn`)
- **Hybrid** — owns its own data + tools (`crm`, `inbox`)

All registered the same way: `app.module(myModule)`. Adding
Notion is one Module package, zero framework edits.

---

## Get started

### The one-liner

Open Cursor (or any agentic CLI — Claude Code, Codex, Gemini)
inside a clone of this repo and say:

> **"deploy boringos shell on my localhost"**

The agent will install dependencies, build the workspace, boot
embedded Postgres, and start the shell on `http://localhost:3000`.

### Manual

```bash
git clone https://github.com/BoringOS-dev/boringos.git
cd boringos
pnpm install
pnpm -r build
pnpm dev
```

Then open `http://localhost:3000`.

### Scaffold your own host

```bash
npx create-boringos my-app
cd my-app && pnpm install && pnpm dev
```

Or wire one inline:

```typescript
import { BoringOS } from "@boringos/core";
import { z } from "@boringos/module-sdk";
import type { Module } from "@boringos/module-sdk";

const helloModule: Module = {
  id: "hello",
  name: "Hello",
  version: "0.1.0",
  description: "Demo module",
  skills: [{ id: "hello", source: "module",
    body: "Use `hello.greet` to say hi to someone." }],
  tools: [{
    name: "greet",
    description: "Greet someone by name",
    inputs: z.object({ name: z.string() }),
    async handler({ name }) {
      return { ok: true, result: { message: `Hello, ${name}!` } };
    },
  }],
};

const app = new BoringOS({});
app.module(helloModule);
await app.listen(3000);
```

Embedded Postgres boots automatically, the tool dispatcher
mounts at `/api/tools/*`, and the agent's prompt now includes
the `hello` skill plus the `hello.greet` tool.

For the step-by-step guide, see
[`BUILD-A-MODULE.md`](BUILD-A-MODULE.md).

---

## Connecting Google (Gmail + Calendar)

The `@boringos/connector-google` Module needs an OAuth client.
Two minutes in Google Cloud Console, then two env vars.

### 1. Google Cloud Console

[`console.cloud.google.com`](https://console.cloud.google.com)

1. **Create a project** (or pick an existing one).
2. **Enable APIs** — `APIs & Services` → `Library`:
   - Gmail API
   - Google Calendar API
3. **OAuth consent screen** — `APIs & Services` → `OAuth consent screen`:
   - User type: `External` (or `Internal` if you're on Workspace)
   - Add your email as a test user while in `Testing` status
   - Add these scopes:
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/calendar.events`
4. **Create OAuth 2.0 Client** — `APIs & Services` → `Credentials`
   → `Create credentials` → `OAuth client ID`:
   - Application type: `Web application`
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URIs:
     `http://localhost:3000/api/connectors/oauth/google/callback`
5. Copy the **Client ID** and **Client secret**.

### 2. Environment variables

Drop these in `.env.local` at the repo root:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

Restart `pnpm dev`, head to the shell's **Connectors** screen,
click **Connect Google**, and finish the OAuth flow. Gmail and
Calendar tools are now available to every agent in that tenant.

> For production hosts, swap `http://localhost:3000` for your
> public origin everywhere above and publish your OAuth consent
> screen.

---

## What's in the box

### Built-in Modules

| Module | Tools | Notes |
|---|---|---|
| `framework` | `tasks.{read,create,patch}`, `comments.post`, `work_products.record`, `runs.report_cost`, `agents.{create,list,wake}`, `inbox.{read,update}` | The agent's universal callback API |
| `memory` | `memory.{remember,recall,prime,forget}` | Long-term memory (Hebbs or null) |
| `drive` | `drive.{read,write,write_binary,list,delete,stat,move}` | File storage with path-prefix ACL |
| `inbox` | `inbox.{list,archive,create_task}` | Inbound message queue |
| `triage` | `triage.{next_pending,classify}` | Inbox classification capability |
| `copilot` | `copilot.start_session` | Per-tenant assistant |
| `workflow` | `workflow.{run,list,get_run}` | DAG runtime + visual editor |

### Connectors

- `@boringos/connector-google` — Gmail (send, search, read,
  archive) + Calendar
- `@boringos/connector-slack` — messages, threads, reactions

### Runtimes

Six pluggable CLI runtimes ship out of the box: Claude Code,
ChatGPT CLI, Gemini, Ollama, generic command, webhook.

### Persistence + transport

- Embedded Postgres by default; external via `DATABASE_URL`
- Drizzle ORM
- Hono HTTP server
- In-process job queue by default; BullMQ via `app.queue(...)`

---

## How an agent works

```
wake (comment / routine / event / admin)
  → coalesce + enqueue
  → fetch agent + create run row
  → build prompt: Skills (from registry) + Tools (from registry)
                  + per-run context (task, comments, session, memory)
  → spawn CLI subprocess with $BORINGOS_CALLBACK_TOKEN
  → agent calls POST /api/tools/<name> with bearer JWT
  → dispatcher: Zod-validate → handler → tool_calls audit row
  → agent posts result comment + sets status=done
  → engine auto-rewakes if more todos remain (success only)
```

Every side effect goes through one URL, validated by one schema,
audited in one table.

---

## Reference docs

- [`BUILD-A-MODULE.md`](BUILD-A-MODULE.md) — step-by-step guide to
  shipping your first Module
- [`MODULES.md`](MODULES.md) — Module manifest spec
- [`TOOLS.md`](TOOLS.md) — Tool spec, error model, audit, idempotency
- [`SKILLS.md`](SKILLS.md) — Skill spec, file format, priorities
- [`CLAUDE.md`](CLAUDE.md) — orientation for contributors
- [`docs/install-flow.md`](docs/install-flow.md) — how Modules are
  packaged, uploaded, installed per-tenant, and uninstalled
- [`docs/INDEX.md`](docs/INDEX.md) — full doc navigation

---

## Packages

| Package | Role |
|---|---|
| `@boringos/core` | `BoringOS` host, builder API, HTTP routes, Module registries |
| `@boringos/module-sdk` | Module / Tool / Skill type SDK (the spec) |
| `@boringos/agent` | Execution engine, context pipeline, registries + dispatcher |
| `@boringos/runtime` | 6 CLI runtimes + subprocess spawning |
| `@boringos/memory` | `MemoryProvider` interface + Hebbs adapter |
| `@boringos/drive` | `StorageBackend` + `DriveManager` |
| `@boringos/db` | Drizzle schema + embedded Postgres + migrations |
| `@boringos/workflow` | DAG runtime |
| `@boringos/workflow-ui` | React canvas + editor |
| `@boringos/pipeline` | Job queue (in-process / BullMQ) |
| `@boringos/connector-google` | Gmail + Calendar Module |
| `@boringos/connector-slack` | Slack Module |
| `@boringos/shell` | Browser shell SPA |
| `@boringos/ui` | Typed API client + React hooks |
| `create-boringos` | CLI generator |
| `@boringos/shared` | Base types, constants, utilities |

---

## Examples

- [`examples/quickstart/`](examples/quickstart/) — boot, create an
  agent, assign a task, watch it execute

---

## Commands

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm test:run
```

---

## License

This monorepo is mixed-license. The kernel and SDKs are MIT so
they win by being everywhere; the shell is source-available
under BUSL-1.1 to keep the commercial surface protected. Each
package directory contains its own `LICENSE` file.

| Path | SPDX | Why |
|---|---|---|
| `packages/@boringos/*` (kernel) | `MIT` | Maximize adoption; SDKs and primitives win by being everywhere |
| `packages/@boringos/connector-*` (Slack, Google) | `MIT` | Same reasoning; community-friendly |
| `packages/@boringos/module-sdk` | `MIT` | The contract third-party developers build Modules against |
| `packages/@boringos/shell` | `BUSL-1.1` (auto-converts to `Apache-2.0` after 4 yr) | Commercial surface; competitors blocked from hosting |

The repo-default `LICENSE` file at the root is **MIT** — it
applies to anything not otherwise marked. See [`LICENSE.md`](LICENSE.md)
for the full matrix and BUSL specifics.

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
