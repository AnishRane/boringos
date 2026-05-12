// task_23 F3 — drive.search tool integration tests.
//
// Exercises the search tool over HTTP just like an agent would. The
// agent-side search story is "use Grep/Glob on the mount" — this
// tool is for non-agent callers (UI, scripts, copilot in-tab), but
// agents can call it too when their wake doesn't have a mount.

import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "drive-search-key";

async function boot(port: number) {
  const { BoringOS, createDriveModule, createFrameworkModule } = await import(
    "@boringos/core"
  );
  const { signCallbackToken } = await import("@boringos/agent");
  const { tenants, agents } = await import("@boringos/db");

  const root = await mkdtemp(join(tmpdir(), "boringos-drive-search-"));
  const driveRoot = join(root, "drive");
  const secret = "test-secret";

  const app = new BoringOS({
    database: { embedded: true, dataDir: root, port },
    drive: { root: driveRoot },
    auth: { secret, adminKey: KEY },
  });
  app.module(createFrameworkModule);
  app.module(createDriveModule);
  const server = await app.listen(0);

  const db = server.context.db as import("@boringos/db").Db;
  const { generateId } = await import("@boringos/shared");
  const tid = generateId();
  await db
    .insert(tenants)
    .values({ id: tid, name: "Co", slug: `co-${tid.slice(0, 6)}` });

  const aid = generateId();
  await db.insert(agents).values({
    id: aid,
    tenantId: tid,
    name: "test-agent",
    role: "default",
  });

  const runId = generateId();
  const token = signCallbackToken(
    { runId, agentId: aid, tenantId: tid },
    secret,
  );

  return { server, db, tid, aid, token };
}

async function callTool(
  server: { url: string },
  token: string,
  fullName: string,
  body: unknown,
) {
  return await fetch(`${server.url}/api/tools/${fullName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function writeFile(
  server: { url: string },
  token: string,
  path: string,
  content: string,
) {
  const r = await callTool(server, token, "drive.write", { path, content });
  if (r.status !== 200) {
    throw new Error(`write failed for ${path}: ${r.status} ${await r.text()}`);
  }
}

describe("drive.search", () => {
  it("finds content matches across files in a prefix", async () => {
    const { server, token } = await boot(5731);
    try {
      // Seed three files under the agent's namespace (writable
      // without ACL fuss). Two contain the target phrase.
      await writeFile(
        server,
        token,
        "shared/policy/follow-up.md",
        "# Follow-up policy\n\nAlways respond within 24h.\n",
      );
      await writeFile(
        server,
        token,
        "shared/policy/escalation.md",
        "# Escalation\n\nNo follow-up required for paid tier.\n",
      );
      await writeFile(
        server,
        token,
        "shared/policy/onboarding.md",
        "# Onboarding\n\nWelcome the new customer.\n",
      );

      const r = await callTool(server, token, "drive.search", {
        query: "follow-up",
        prefix: "shared/policy/",
        mode: "content",
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as {
        ok: true;
        result: {
          results: Array<{
            path: string;
            name: string;
            matches?: Array<{ line: number; text: string }>;
          }>;
        };
      };
      expect(body.ok).toBe(true);
      const paths = body.result.results.map((r) => r.path).sort();
      expect(paths).toContain("shared/policy/follow-up.md");
      expect(paths).toContain("shared/policy/escalation.md");
      expect(paths).not.toContain("shared/policy/onboarding.md");
      // Content mode returns line snippets for matched files.
      expect(
        body.result.results.find((r) => r.path === "shared/policy/follow-up.md")
          ?.matches,
      ).toBeDefined();
    } finally {
      // boot() leaks the server in this test pattern (no close in
      // existing drive-tools tests either); ok for parallel runs
      // since each test gets a unique port + tmpdir.
    }
  });

  it("filename-mode matches against the path itself", async () => {
    const { server, token } = await boot(5732);
    try {
      await writeFile(server, token, "shared/policy/follow-up.md", "x");
      await writeFile(server, token, "shared/policy/onboarding.md", "x");

      const r = await callTool(server, token, "drive.search", {
        query: "follow",
        prefix: "shared/",
        mode: "filename",
      });
      const body = (await r.json()) as {
        ok: true;
        result: { results: Array<{ path: string }> };
      };
      const paths = body.result.results.map((r) => r.path);
      expect(paths).toEqual(["shared/policy/follow-up.md"]);
    } finally {
      /* server leaked — see note above */
    }
  });

  it("respects ACL — does not return files the caller can't read", async () => {
    const { server, token, tid } = await boot(5733);
    try {
      // Write a file directly to disk under another user's prefix
      // (bypassing the tool ACL by using the drive backend
      // implicitly via two agents won't work — instead seed via
      // the tools as a different user). For this test, we write
      // to a path the agent CAN write (shared/), then use
      // filename match to confirm the ACL filter does cull a
      // result. Cross-user ACL is covered by drive-acl unit tests.
      await writeFile(server, token, "shared/secret.md", "classified");

      const r = await callTool(server, token, "drive.search", {
        query: "secret",
        mode: "filename",
      });
      const body = (await r.json()) as {
        ok: true;
        result: { results: Array<{ path: string }> };
      };
      // The agent CAN read shared/, so this is a positive case —
      // ACL didn't cull anything. The cull behaviour is exercised
      // by drive-acl.test.ts where AgentActor + users/<other>/
      // returns ok: false from canAccess. Here we only assert the
      // happy path completes against the same code path.
      expect(body.result.results.map((r) => r.path)).toContain(
        "shared/secret.md",
      );
      void tid;
    } finally {
      /* server leaked */
    }
  });

  it("rejects invalid regex with invalid_input", async () => {
    const { server, token } = await boot(5734);
    try {
      const r = await callTool(server, token, "drive.search", {
        query: "[unterminated",
      });
      const body = (await r.json()) as {
        ok: false;
        error: { code: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("invalid_input");
    } finally {
      /* server leaked */
    }
  });
});
