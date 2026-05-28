# `@boringos/dev-host`

A reusable headless harness that boots BoringOS with every built-in
module, registers your module from a `.hebbsmod` archive or a built
package directory, seeds a tenant, mints a callback JWT, and exposes
a minimal API for asserting against the running host. Used by
`@boringos/hebbs-cli` (`hebbs test`), the framework's E2E suite, and
any future scaffolder / CI / grading tool.

## Install

```bash
pnpm add -D @boringos/dev-host
```

## API

### `createDevHost(opts: DevHostOptions): Promise<DevHost>`

Boots BoringOS, installs the module at `opts.modulePath`, and returns
a `DevHost` you can drive. Single function call replaces the bespoke
`scripts/try-runtime-install.mjs` orchestration.

#### `DevHostOptions`

| Field | Type | Default | Notes |
|---|---|---|---|
| `modulePath` | `string` | (required) | Either a path to a `.hebbsmod` archive OR a directory containing `index.mjs` + `module.json`. |
| `encryptionKey` | `string` | random 64-char hex | Sets `BORINGOS_ENCRYPTION_KEY` — required by AuthManager (#60). |
| `pgPort` | `number` | random 5400–5599 | Embedded-Postgres port. |
| `jwtSecret` | `string` | random UUID | Auth signing secret. |
| `frameworkRoot` | `string` | dev-host's repo root | Where the extracted bundle lives; must let Node resolve `@boringos/*` from `node_modules`. |

#### `DevHost`

| Member | Type | Notes |
|---|---|---|
| `url` | `string` | Base URL of the embedded server (e.g. `http://localhost:55321`). |
| `tenantId` | `string` | UUID of the test tenant — pre-installed with your module. |
| `callbackToken` | `string` | Signed JWT for the seeded agent. Pass as `Authorization: Bearer ${token}`. |
| `db` | `Db` | Drizzle handle scoped to the embedded Postgres. |
| `moduleId` | `string` | `module.json.id` of the installed module. |
| `moduleVersion` | `string` | `module.json.version` of the installed module. |
| `dispatch<T>(fullToolName, inputs): Promise<T>` | function | HTTP dispatch against `/api/tools/<full-name>`. Returns the JSON envelope; throws on non-200. |
| `close(): Promise<void>` | function | Tear down the server, drop the extract dir, remove the per-run dataDir. |

## Example: assert a tool round-trips to the DB

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createDevHost } from "@boringos/dev-host";

describe("CRM round-trip", () => {
  it("crm.contacts.create writes a row", async () => {
    const host = await createDevHost({
      modulePath: "./fixtures/crm-0.3.0.hebbsmod",
    });
    try {
      // 1. Dispatch a tool through the HTTP surface.
      const r = await host.dispatch<{
        ok: true;
        result: { data: { id: string } };
      }>("crm.contacts.create", {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      });
      expect(r.ok).toBe(true);

      // 2. Use the raw `db` handle to assert the row exists.
      const rows = (await host.db.execute(sql`
        SELECT id, email FROM crm__contacts
        WHERE id = ${r.result.data.id}::uuid
          AND tenant_id = ${host.tenantId}::uuid
      `)) as Array<{ id: string; email: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe("ada@example.com");
    } finally {
      await host.close();
    }
  });
});
```

## Patterns

### Tool dispatch

Every module tool is reachable at `POST /api/tools/<module-id>.<tool-name>`
with the callback JWT in the `Authorization` header. `dispatch()`
threads that for you and returns the parsed JSON. If you need to
exercise non-tool routes, hit `host.url` with `fetch` directly.

### Database assertions

`host.db` is the same Drizzle handle the host uses. Mix raw `sql`\`\`
fragments with Drizzle's typed query builders — both work. Use the
tenant id from `host.tenantId` to scope writes / reads to the test
tenant. Schema tables your module ships (`<id>__*`) are created
automatically by the install step.

### Multi-module setups

Call `createDevHost` once per host. Each call boots a fresh embedded
Postgres on its own port and gets its own `dataDir`, so tests can
run in parallel. Tear down with `host.close()` to free the port and
remove the temp dirs.

### CI usage

If your runner doesn't have `unzip` available, prefer the
"directory containing index.mjs + module.json" form of `modulePath`
— `pack-hebbsmod` produces that directory in `<pkg>/dist/` before
zipping it.

## See also

- [`@boringos/hebbs-cli`](../hebbs-cli) — `hebbs test <module>` is a
  ~120-line thin wrapper over `createDevHost`.
- [`BUILD-A-MODULE.md`](../../../BUILD-A-MODULE.md) — write a module
  from scratch.
- [`docs/install-flow.md`](../../../docs/install-flow.md) — the
  upload / extract / install path this harness automates.
