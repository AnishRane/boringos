# Connector SDK v2 + MDK — scaling assessment

> **Date:** 2026-05-29
> **Context:** Honest forecast after shipping PR #60 (Connector SDK v2). Asked the question: "Will connector SDK + Parag's MDK make it super easy to ship modules at scale, or are there fundamental gaps?"
> **Punchline:** Necessary but not sufficient. Plumbing is good. Product layer for ecosystem isn't built yet.

---

## What this is

A persistent note to revisit when planning what comes after the Connector SDK v2 / MDK work merges. Saving this because the day-to-day shipping conversation makes it tempting to assume that getting the SDK right gets the ecosystem right. It doesn't. There's a second layer of investments that "make a thriving ecosystem" requires, and they're different from plumbing work.

---

## What the SDK + MDK actually solve (plumbing is real)

The mechanical "I want to build a module" path goes from broken to easy.

| Friction (before this work) | After SDK v2 + MDK |
|---|---|
| Clone the framework monorepo, fix symlinks, get monorepo green | `pnpm add @boringos/module-sdk @boringos/connector-google` |
| Read framework internals to understand OAuth | `deps.getConnectorToken("google", "my-module")` returns a refreshing token |
| Write own credential storage, refresh, retry | AuthManager handles it generically |
| New connector means editing core | `pnpm add @boringos/connector-microsoft` |
| No typed contract | All types in `@boringos/module-sdk` |
| Ship code = broken without framework checkout | `.hebbsmod` upload pipeline + signature check |

**The developer experience for shipping the first 1-5 modules is solved.** Someone can sit down today (after MDK Phase 5) and have a working module in an hour.

---

## What's still fundamentally hard

These bite past 5-10 modules into "ecosystem" territory.

### 1. Skill prompt bloat — hard ceiling at ~20 active modules per tenant

Every module's `skills[]` concatenates into the agent's system prompt under `## Skills`. This is the framework's whole design.

- A module ships ~5 skill files (50-200 lines each)
- 20 modules installed in one tenant = 100 skill chunks
- That's 10-30k tokens of skill content on every agent invocation, before the actual task

Past 20 active modules, the context window degrades agent reasoning. There's no skill-relevance ranking, no on-demand loading, no skill compression. **Architectural ceiling.**

### 2. No marketplace, no discovery

After publishing `@boringos/connector-microsoft`, how do people find it?
- Today: search npm by hand, someone links it on Discord, Parag curates
- No `hebbs.dev/marketplace`, no in-Shell "browse modules," no ratings, no install counts
- Without this, modules are point-to-point sharing, not ecosystem

### 3. No module-developer docs

What exists:
- `BUILD-A-MODULE.md` (sparse)
- `docs/thesis.md` (architectural, framework-dev oriented)
- Spec + plan files (internal)

What's missing:
- "Hello world module" tutorial
- Recipe book ("how do I send a Slack message when X happens?")
- Reference for every dep method
- Migration guides for breaking changes
- Worked examples

A developer with no BoringOS context can't sit down and ship without significant onboarding even after MDK Phase 5.

### 4. Zero observability for module authors

If 50 tenants install your CRM module, you can't see:
- Which tenants use which tools
- Error rates across the install base
- Which versions are deployed where
- Which features are unused (to deprecate)

Audit tables (`tool_calls`, `runs`, `connector_token_issuance`) live at host level. Host operator sees usage. Module author sees nothing. No telemetry SDK, no opt-in error reporting, no usage analytics.

**This kills the iteration loop for serious module authors.**

### 5. Support story is undefined

When a tenant's CRM module breaks at 2am, who do they contact? Tenant admin → host operator → module author → ??? Missing:
- Support contact field on Module manifests
- Issue tracker per module
- SLA framework
- Way for module authors to push critical fixes to all installs

Solvable, but organizational, not technical.

### 6. Shell extension contract is implicit

Modules can register tools. Shell has hardcoded screens (Calendar, Inbox) calling specific tool names. A module that wants its own screen must:
- Ship a `PluginUI` declaration (works for widgets)
- Or convince the host operator to add a new nav item (manual)

No clear "third-party module ships its own dedicated screen" story.

### 7. Revenue + license

- Framework is AGPL-3.0 — hard sell for commercial module authors
- LGPL on `module-sdk` partially helps (closed-source modules allowed against the SDK)
- No clear "how do I, as a module author, get paid?" story
- No app store revenue share, no managed billing, no licensing primitives for modules

### 8. Upgrade safety / seeding policy

Open question in Parag's MDK. When v2 of a module uploads:
- Do declared `agents/workflows/routines` re-seed?
- What about tenant edits to those?
- Schema-incompatible v2?

Without a clean answer, module authors ship "stay on v1" guidance. Ecosystem stagnates.

### 9. The hardcoded `gmail.*` / `calendar.*` problem

PR #60's Path B retreat is honest about this. Shell's Calendar/Inbox screens hardcode tool names. A module wanting Gmail can:
- Use built-in `gmail.*` tools (shared namespace with everyone)
- Use the SDK directly (Shell won't render results)

For a tool-rich ecosystem, modules need their own UI surface OR the Shell needs to be more pluggable.

---

## Scaling forecast

| Module count | What we have | What we need |
|---|---|---|
| **1-5 modules** | Sufficient. Ship today. | Nothing more. |
| **5-20 modules** | Works but rough. | Better docs, basic marketplace, error reporting. |
| **20+ modules per tenant** | Hits skill prompt ceiling. | Skill relevance / on-demand loading. |
| **100+ modules in ecosystem** | Marketplace required. | Discovery, ratings, revenue, support model. |
| **1000+ module authors** | Far from there. | Different conversation — app store dynamics. |

---

## What this means for next steps

The PR #60 / MDK work is **plumbing**. Type-safe, multi-account, encrypted, npm-installable, dynamically discovered. That part is good and shippable.

The **product layer** (marketplace, docs, observability, revenue, support) is the next investment, and it's a different kind of work. Likely sequence after MDK lands:

1. **Module developer docs site** — tutorials, recipes, reference. Highest leverage for the first 5 modules.
2. **Telemetry SDK** — opt-in error reporting from module to author. Unblocks serious iteration.
3. **Skill-relevance ranking or on-demand loading** — fixes the 20-modules ceiling.
4. **Lightweight marketplace** — even a curated GitHub list to start. Discovery is the bottleneck for adoption.
5. **Module review process** — for hostd deployments, who blocks a malicious module?
6. **Revenue + licensing primitives** — when the first commercial module wants to charge.

None of these need to land before #60 merges. All of them should be on the roadmap.

---

## Comparison points (for sanity-checking trajectory)

- **Vercel/Next.js apps**: massive ecosystem because one framework + marketplace + universal deploy + detailed app-dev docs. We have the framework. Don't have the rest.
- **Zapier/Make integrations**: massive ecosystem because visual builder + abstracted connection layer + revenue share + strict review. We have the connection layer. Don't have the rest.
- **WordPress plugins**: massive ecosystem because stable hooks + plugin directory + permissive license + 15+ years momentum. We have stable hooks. License (AGPL) is restrictive. Directory doesn't exist.

---

## How to use this note

Revisit when:
- Considering "what should we build next after MDK lands?"
- A reviewer asks "why isn't [X observability/marketplace/etc] in this PR?"
- A potential module author asks "is this ready for me to bet my product on?"
- Planning the second half of 2026 / 2027 roadmap

The plumbing in PR #60 + MDK doesn't go stale. The forecast in this note will need updating once each next investment lands (or doesn't).
