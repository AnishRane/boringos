// SPDX-License-Identifier: GPL-3.0-or-later
//
// `inbox-replier` Module — replaces the legacy generic-replier app.
//
// Provides the operations-persona reply-drafting agent and the
// inbox-fanout workflow that wakes it on every `inbox.item_created`
// event. Drafts a generic reply (no CRM/domain context) and appends
// to `metadata.replyDrafts`. Never auto-sends.
//
// `defaultInstall: true` so a fresh tenant gets reply drafts for free,
// matching the  generic-replier behaviour before its deletion in
// task_21 Phase E.

import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  Module,
  ModuleFactory,
  ModuleLifecycle,
  ModuleFactoryDeps,
} from "@boringos/module-sdk";
import type { Db } from "@boringos/db";

const REPLIER_AGENT_ROLE = "operations";
const REPLIER_AGENT_NAME = "Generic Email Replier";
const REPLIER_WORKFLOW_NAME = "Draft generic reply for incoming items";

const REPLIER_AGENT_INSTRUCTIONS = [
  "You are a workflow agent that decides whether to append a generic reply draft to an inbox item, and writes it via the framework tool API. You DO work; you do not answer questions. Your output is tool calls, not prose.",
  "",
  "Each task description starts with the action directive, then `--- email follows ---`, then header lines (including `list-unsubscribe`, `list-id`, `auto-submitted`, `precedence`, `reply-to`, `prefilter`), then `---`, then the email body.",
  "",
  "You wake on every classified item. THE DECISION TO DRAFT IS YOURS — there is no upstream gate.",
  "",
  "REQUIRED steps in order. Use the Bash tool. Do not narrate; execute.",
  "",
  "  Step 1. Parse `inbox-item-id` from the headers. Save as ITEM_ID.",
  "",
  "  Step 2. Read the current item so you have triage metadata + headers + sender:",
  "      curl -sS -X POST $BORINGOS_CALLBACK_URL/api/tools/framework.inbox.read \\",
  "        -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
  "        -H 'Content-Type: application/json' \\",
  "        -d \"{\\\"itemId\\\":\\\"$ITEM_ID\\\"}\"",
  "    The response's `result.metadata` field is the existing object you must merge into. Pull `result.metadata.triage.label`, `result.from`, and `result.metadata.email.headers`.",
  "",
  "  Step 3. SKIP the draft if any of these are true. Skipping is the common case — be aggressive.",
  "    - `metadata.triage.label` is `noise` (auto-archive material — pointless to draft for) OR `fyi` (informational, no decision needed).",
  "    - `metadata.email.headers.listUnsubscribe` is non-empty, OR `listId` is non-empty, OR `precedence` is `bulk`/`list`/`junk` — bulk mailer.",
  "    - `metadata.email.headers.autoSubmitted` is anything other than `null` / `no` — auto-generated mail (vacation reply, calendar invite system notice).",
  "    - The body looks like a newsletter footer (single paragraph + 'unsubscribe' link), or the `from` address is `noreply@` / `no-reply@` / `notifications@` AND `replyTo` is empty.",
  "    - `prefilter: automated` line is present — already classified as automated upstream.",
  "    - The `from` address is the user's own address (an email they sent to themselves; no point drafting a reply to yourself). The user's primary address is the one connected via the Gmail connector — when in doubt, treat any sender that uses the same domain AND name pattern as user-self.",
  "    If skipping, go directly to Step 5. Do NOT call `framework.inbox.update`.",
  "",
  "  Step 4. Otherwise — draft a polite, generic reply (3-6 sentences, plain text, no HTML, no CRM-specific knowledge). Then APPEND via `framework.inbox.update`. The tool replaces `metadata` wholesale — copy every existing key, then add or extend `replyDrafts`:",
  "      curl -sS -X POST $BORINGOS_CALLBACK_URL/api/tools/framework.inbox.update \\",
  "        -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
  "        -H 'Content-Type: application/json' \\",
  "        -d '{\"itemId\":\"<ITEM_ID>\",\"metadata\":<MERGED_OBJECT_HERE>}'",
  "    Where <MERGED_OBJECT_HERE> = existing metadata + replyDrafts: [...existing.replyDrafts || [], {author: 'inbox-replier', draftedAt: '<ISO>', body: '<your draft text>'}].",
  "    Verify the response is `{\"ok\":true,...}`. If not, retry once. If still failing, your task fails.",
  "",
  "  Step 5. Mark task done — whether you drafted or skipped:",
  "      curl -sS -X POST $BORINGOS_CALLBACK_URL/api/tools/framework.tasks.patch \\",
  "        -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
  "        -H 'Content-Type: application/json' \\",
  "        -d '{\"taskId\":\"$BORINGOS_TASK_ID\",\"status\":\"done\"}'",
  "",
  "Hard rules:",
  "  - Skipping is the right answer for newsletters, automated mail, fyi/noise items, and self-sent mail. Do not draft for any of these.",
  "  - The work is complete only after Step 5 returns success — even on a skip path.",
  "  - Never send replies (no SMTP, no Gmail send_email).",
  "  - Never overwrite `metadata.replyDrafts` — always merge.",
  "  - Never overwrite other apps' keys in metadata (preserve `triage`, `email`, `crm.lens`, etc.).",
].join("\n");

const REPLIER_SKILL = `# Inbox Reply Drafter

You are the generic reply drafter. For incoming inbox items, decide
whether a reply makes sense and — when it does — draft a polite,
neutral suggestion and append it to the item's drafts list. **You do
not take ownership of the item.** Domain-specific modules (CRM,
Support, etc.) may also draft suggestions for the same item; the user
sees a list and picks which to send.

## Wake model

You wake on every \`inbox.item_created\` event. The framework no
longer pre-filters — that gate was brittle. The decision to draft or
skip is yours. Skipping is the common case and is cheap (no LLM body
generation, just a \`framework.tasks.patch\` to close the task).

## What you do

For each inbox item:

1. Read the inbox item (\`framework.inbox.read\`)
2. Decide skip-or-draft based on the rules below
3. If drafting: append to \`metadata.replyDrafts\` via \`framework.inbox.update\`
4. Mark the task done (\`framework.tasks.patch\`) — whether you drafted or skipped

## Skip rules — be aggressive

Skip drafting if **any** of these hold:

- \`metadata.triage.label\` is \`noise\` — auto-archive material
- \`metadata.triage.label\` is \`fyi\` — informational, no decision needed
- \`metadata.email.headers.listUnsubscribe\` is non-empty — bulk mailer
- \`metadata.email.headers.listId\` is non-empty — mailing list
- \`metadata.email.headers.precedence\` is \`bulk\`, \`list\`, or \`junk\`
- \`metadata.email.headers.autoSubmitted\` is anything other than null / \`no\`
- The \`from\` address is \`noreply@\`, \`no-reply@\`, \`notifications@\`, etc. AND \`replyTo\` is empty
- The body looks like a newsletter footer
- The sender is the user themselves
`;

interface ReplierDeps {
  db: Db;
}

function buildLifecycle(deps: ReplierDeps): ModuleLifecycle {
  const installHandler = async (ctx: { tenantId: string; moduleId: string }) => {
    const runtimes = (await deps.db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${ctx.tenantId} AND type = 'claude' LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    const runtimeId = runtimes[0]?.id;
    if (!runtimeId) {
      // eslint-disable-next-line no-console
      console.warn(
        `[inbox-replier] No Claude runtime for tenant ${ctx.tenantId}; skipping seed`,
      );
      return;
    }

    const rootRows = (await deps.db.execute(sql`
      SELECT id FROM agents
      WHERE tenant_id = ${ctx.tenantId} AND reports_to IS NULL
      ORDER BY created_at ASC LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    const rootAgentId = rootRows[0]?.id ?? null;

    await scrubInboxReplier(deps, ctx.tenantId);

    const agentId = randomUUID();
    await deps.db.execute(sql`
      INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, reports_to, created_at, updated_at)
      VALUES (${agentId}, ${ctx.tenantId}, ${REPLIER_AGENT_NAME}, ${REPLIER_AGENT_ROLE}, 'idle',
        ${REPLIER_AGENT_INSTRUCTIONS}, ${runtimeId}, ${rootAgentId}, now(), now())
    `);

    const workflowId = randomUUID();
    const blocks = [
      { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: { eventType: "inbox.item_created" } },
      {
        id: "task",
        name: "task",
        kind: "tool",
        type: "tool",
        tool: "framework.tasks.create",
        inputs: {
          title: "Append reply draft to inbox item {{trigger.itemId}}",
          description:
            "ACTION: Use the Bash tool to append a generic reply draft to this inbox item's `metadata.replyDrafts[]` via framework.inbox.update.\n" +
            "If the email is a newsletter, automated notice, or spam, skip drafting; just mark the task done.\n" +
            "Otherwise: GET the item, draft a polite reply (3-6 sentences), append your draft to the existing replyDrafts array, PATCH the merged metadata, then mark the task done.\n" +
            "Do not respond with prose. Use Bash + curl. Your run is incomplete until the PATCH succeeds.\n" +
            "\n--- email follows ---\n" +
            "inbox-item-id: {{trigger.itemId}}\nsource: {{trigger.source}}\nfrom: {{trigger.from}}\nsubject: {{trigger.subject}}\n---\n{{trigger.body}}",
          originKind: "inbox.draft_reply",
          assigneeAgentId: agentId,
        },
        config: {},
      },
    ];
    const edges = [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "task", sourceHandle: null, sortOrder: 0 },
    ];
    await deps.db.execute(sql`
      INSERT INTO workflows (id, tenant_id, name, type, status, blocks, edges, created_at, updated_at)
      VALUES (${workflowId}, ${ctx.tenantId}, ${REPLIER_WORKFLOW_NAME}, 'system', 'active',
        ${JSON.stringify(blocks)}::jsonb, ${JSON.stringify(edges)}::jsonb, now(), now())
    `);
  };

  return {
    onInstall: installHandler,
    onTenantCreate: installHandler,
    async onUninstall(ctx) {
      await scrubInboxReplier(deps, ctx.tenantId);
    },
  };
}

async function scrubInboxReplier(deps: ReplierDeps, tenantId: string): Promise<void> {
  const agentFilter = sql`tenant_id = ${tenantId} AND name = ${REPLIER_AGENT_NAME} AND role = ${REPLIER_AGENT_ROLE}`;
  const workflowFilter = sql`tenant_id = ${tenantId} AND name = ${REPLIER_WORKFLOW_NAME}`;

  await deps.db.execute(sql`
    DELETE FROM cost_events WHERE run_id IN (
      SELECT id FROM agent_runs WHERE agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
    )
  `);
  await deps.db.execute(sql`
    DELETE FROM agent_runs WHERE agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
  `);
  await deps.db.execute(sql`
    DELETE FROM agent_wakeup_requests WHERE agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
  `);
  await deps.db.execute(sql`
    DELETE FROM workflow_runs WHERE workflow_id IN (SELECT id FROM workflows WHERE ${workflowFilter})
  `);
  await deps.db.execute(sql`DELETE FROM workflows WHERE ${workflowFilter}`);
  await deps.db.execute(sql`
    UPDATE tasks SET assignee_agent_id = NULL WHERE assignee_agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
  `);
  await deps.db.execute(sql`
    UPDATE tasks SET created_by_agent_id = NULL WHERE created_by_agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
  `);
  await deps.db.execute(sql`DELETE FROM agents WHERE ${agentFilter}`);
}

export const createInboxReplierModule: ModuleFactory = (factoryDeps: ModuleFactoryDeps) => {
  const db = factoryDeps.db as Db;
  const deps: ReplierDeps = { db };

  const module: Module = {
    id: "inbox-replier",
    name: "Inbox Replier",
    version: "0.1.0",
    description:
      "Operations-persona agent that drafts generic reply suggestions for inbound mail (skips noise/fyi/bulk/auto). Coexists with domain-specific repliers — multiple modules can suggest, the user picks.",
    provides: ["inbox-replier"],
    dependsOn: [{ capability: "inbox" }],
    defaultInstall: true,
    skills: [
      {
        id: "inbox-replier",
        source: "module",
        body: REPLIER_SKILL,
        priority: 50,
        appliesTo: (event) => event.agentRole === REPLIER_AGENT_ROLE,
      },
    ],
    lifecycle: buildLifecycle(deps),
  };

  return module;
};
