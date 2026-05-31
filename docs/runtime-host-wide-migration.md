# Migration: per-tenant runtime layer removed (runtime is now host-wide)

**Audience:** anyone who has built a BoringOS module (`.hebbsmod`) or a frontend against the admin API.

**TL;DR:** The per-tenant `runtimes` table, the `/api/admin/runtimes` CRUD API,
and the `agents.runtime_id` / `agents.fallback_runtime_id` columns are gone.
The runtime (which harness/CLI — Claude, Pi, Codex, …) is now **host-wide**, set
once at deploy via `BORINGOS_RUNTIME`. **Per-agent model selection is unchanged**
(`agents.model`), and now sources its options from the host runtime.

---

## Why

Runtime selection became host-wide in `dc748a4` (the engine resolves
`BORINGOS_RUNTIME` at wake time and ignored `agent.runtime_id`). The per-tenant
`runtimes` table was left as dead weight: it confused new tenants (it's empty by
design) and led to modules silently no-op'ing their install when they gated on a
"is there a runtime?" check that can never pass on a fresh tenant. This change
finishes that migration and removes the dead surface.

## What changed

| Removed | Replacement |
|---|---|
| `runtimes` **table** (per-tenant rows) | Kept as an **empty, read-only compat shim** so old modules don't hard-crash. Do **not** rely on it. |
| `agents.runtime_id` / `agents.fallback_runtime_id` columns | Gone. Runtime is host-wide; the engine never read these. |
| `GET/POST/PATCH/DELETE /api/admin/runtimes`, `/runtimes/:id/default`, `/runtimes/:id/models` | `GET /api/admin/runtime/models` — the **host** runtime's model catalog. |
| `runtimeId` on `POST/PATCH /api/admin/agents` and `/agents/from-template` | Drop it. Use `model` for a per-agent model override. |
| `@boringos/ui` `useRuntimes`, `getRuntimes`, `createRuntime`, `updateRuntime`, `deleteRuntime`, `setDefaultRuntime` | Removed. `useRuntimeModels()` now takes **no argument** and returns the host runtime's models. |
| `Agent.runtimeId` / `Agent.fallbackRuntimeId` (`@boringos/shared`) | Removed. `Agent.model` stays. |

## New / unchanged

- **Per-agent model override stays:** set `agents.model` (via `PATCH /api/admin/agents/:id` with `{ "model": "..." }`). The engine passes it as the runtime's `--model`.
- **Host model catalog:** `GET /api/admin/runtime/models` → `{ type, models: [{ id, label }] }` for the configured `BORINGOS_RUNTIME`.
- **Host runtime config** (for `command` / `webhook` runtimes that need a command path or URL): set `BORINGOS_RUNTIME_CONFIG` to a JSON object at deploy time (replaces the old per-tenant `runtimes.config`).
- **Default Claude model is now Haiku** when no per-agent `agents.model` / `BORINGOS_MODEL` is set.

---

## What module authors must do

### 1. Remove any `runtimes` lookups in lifecycle hooks

If your `onInstall` / `onTenantCreate` does anything like this, **delete it**:

```ts
// ❌ OLD — silently no-ops on every fresh tenant
const rows = await db.execute(sql`
  SELECT id FROM runtimes WHERE tenant_id = ${ctx.tenantId} AND type = 'claude' LIMIT 1
`);
const runtimeId = rows[0]?.id;
if (!runtimeId) return;        // ← this branch always taken on fresh tenants
await db.execute(sql`INSERT INTO agents (..., runtime_id, ...) VALUES (..., ${runtimeId}, ...)`);
```

Seed agents with **no** `runtime_id`. Prefer `Lifecycle.seed`, which already does the right thing:

```ts
// ✅ NEW — runtime is host-wide; engine resolves at wake
await Lifecycle.seed(ctx, { agents: [{ name: "My Agent", persona: "...", instructions: "" }] });
```

If you insert agents with raw SQL, drop `runtime_id` from the column list entirely.

### 2. Drop `runtime_id` from any agent INSERT/UPDATE

The column no longer exists. Any `INSERT INTO agents (... runtime_id ...)` will throw.

### 3. Update your frontend (if any)

- Replace the per-tenant "Runtimes" screen — there's nothing per-tenant to configure now.
- Remove the per-agent **runtime** picker; keep a per-agent **model** picker fed by `GET /api/admin/runtime/models`, writing to `agents.model`.
- Stop sending `runtimeId` on agent create/update.

### 4. Re-pack and re-publish

Re-bundle your `.hebbsmod` against the current framework and bump your version.

---

## Compatibility window

The empty `runtimes` table is retained **temporarily** so already-published
packages that still `SELECT ... FROM runtimes` degrade gracefully (empty result →
your "no runtime, skip" branch) instead of crashing on a missing relation. A
**future major release will drop the table** — do not ship new code that reads it.

## Reference

The built-in `inbox-triage` / `inbox-replier` modules and the `boringos-crm`
module have already been migrated — use them as worked examples.
