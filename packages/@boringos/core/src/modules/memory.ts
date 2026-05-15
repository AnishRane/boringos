// SPDX-License-Identifier: GPL-3.0-or-later
//
// `memory` Module — wraps the configured MemoryProvider, exposing
// `memory.{remember, recall, forget}` tools plus a SKILL.md teaching
// agents the opinionated 4-folder layout, read order on wake, and
// user-vs-tenant routing call.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";
import type { MemoryProvider } from "@boringos/memory";

// task_24 D — load the canonical SKILL.md from disk. Lives alongside
// this file in `./memory/SKILL.md`. Fallback to inline placeholder
// in the (vanishingly rare) case the file's missing from the dist
// bundle — keeps the module loadable instead of crashing boot.
const MEMORY_SKILL = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, "memory", "SKILL.md"), "utf8");
  } catch {
    return "# Memory\n\nUse memory.remember / memory.recall to persist facts across runs.";
  }
})();

export const createMemoryModule: ModuleFactory = (deps) => {
  const memory = deps.memory as MemoryProvider | undefined;

  const rememberTool: Tool = {
    name: "remember",
    description:
      "Store a fact for cross-run recall. Default scope follows the wake's human context: 'user' when an owner is set (lands under users/<owner>/memory/notes/), 'tenant' otherwise (lands under shared/memory/notes/). Override scope: 'tenant' to promote a fact to tenant-canonical truth.",
    inputs: z.object({
      content: z.string(),
      tags: z.array(z.string()).optional(),
      importance: z.number().optional(),
      entityId: z.string().optional(),
      scope: z.enum(["user", "tenant"]).optional(),
    }),
    async handler(
      input: {
        content: string;
        tags?: string[];
        importance?: number;
        entityId?: string;
        scope?: "user" | "tenant";
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!memory) {
        return {
          ok: false,
          error: { code: "upstream_unavailable", message: "Memory provider not configured", retryable: false },
        };
      }
      const scope = input.scope ?? (ctx.wakeOwnerUserId ? "user" : "tenant");
      if (scope === "user" && !ctx.wakeOwnerUserId) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message:
              "Cannot write user-scope memory without a wake owner. Route this fact to scope='tenant' or invoke from a user-initiated wake.",
            retryable: false,
          },
        };
      }
      const id = await memory.remember(input.content, {
        tenantId: ctx.tenantId,
        scope,
        ownerUserId: ctx.wakeOwnerUserId,
        entityId: input.entityId,
        tags: input.tags,
        importance: input.importance,
      });
      return { ok: true, result: { memoryId: id, scope } };
    },
  };

  const recallTool: Tool = {
    name: "recall",
    description:
      "Search across the in-scope memory tree. Returns the top matches with their content + path. Default: searches both user-scope (the wake-owner's) and tenant-shared. Restrict with `scope` if you want one or the other.",
    inputs: z.object({
      query: z.string(),
      limit: z.number().int().positive().optional(),
      entityId: z.string().optional(),
      scope: z.enum(["user", "tenant"]).optional(),
    }),
    async handler(
      input: {
        query: string;
        limit?: number;
        entityId?: string;
        scope?: "user" | "tenant";
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!memory) {
        return {
          ok: false,
          error: { code: "upstream_unavailable", message: "Memory provider not configured", retryable: false },
        };
      }
      const results = await memory.recall(input.query, {
        tenantId: ctx.tenantId,
        scope: input.scope,
        ownerUserId: ctx.wakeOwnerUserId,
        limit: input.limit,
        entityId: input.entityId,
      });
      return { ok: true, result: { results } };
    },
  };

  const forgetTool: Tool = {
    name: "forget",
    description:
      "Remove a memory by id. The id is what `remember` returned — the path relative to the tenant root.",
    inputs: z.object({ memoryId: z.string() }),
    async handler(
      input: { memoryId: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!memory) {
        return {
          ok: false,
          error: { code: "upstream_unavailable", message: "Memory provider not configured", retryable: false },
        };
      }
      // forget() takes the absolute backend path. The drive-backed
      // provider expects `<tenantId>/<rel>` — compose from ctx +
      // the rel id remember() handed out.
      const fullPath = `${ctx.tenantId}/${input.memoryId}`;
      await memory.forget(fullPath);
      return { ok: true, result: { ok: true } };
    },
  };

  const module: Module = {
    id: "memory",
    name: "Memory",
    version: "0.1.0",
    description: "Cross-run cognitive memory for agents",
    provides: ["memory"],
    skills: [
      {
        id: "memory",
        source: "module",
        body: MEMORY_SKILL,
        priority: 60,
      },
    ],
    tools: [rememberTool, recallTool, forgetTool],
  };

  return module;
};
