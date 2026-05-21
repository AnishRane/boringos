// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `inbox-triage` Module — generic email-triage agent + skill.
//
// Provides the operations-persona triage agent and the inbox-fanout
// workflow that wakes it on every `inbox.item_created` event. The
// classification *tools* (`triage.classify`, `triage.score`) are
// owned by the separate `triage` Module — this Module owns the
// agent + workflow + classification SKILL that USE those tools.
//
// `defaultInstall: true` so a fresh tenant gets inbox classification
// for free, providing classification + tagging out of the box
// before its deletion in task_21 Phase E.

import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  Module,
  ModuleFactory,
  ModuleLifecycle,
  ModuleFactoryDeps,
} from "@boringos/module-sdk";
import type { Db } from "@boringos/db";

const TRIAGE_AGENT_ROLE = "operations";
const TRIAGE_AGENT_NAME = "Generic Inbox Triage";
const TRIAGE_WORKFLOW_NAME = "Triage incoming inbox items";

const TRIAGE_AGENT_INSTRUCTIONS = [
  "You triage inbox items. See the inbox-triage SKILL for the full ruleset.",
  "",
  "Your task description starts with header lines, then `---`, then the email body. Example:",
  "    inbox-item-id: <uuid>",
  "    source: google.gmail",
  "    from: <sender>",
  "    subject: <subject>",
  "    list-unsubscribe: <header value or 'none'>",
  "    list-id: <header value or 'none'>",
  "    auto-submitted: <header value or 'none'>",
  "    precedence: <header value or 'none'>",
  "    reply-to: <header value or 'none'>",
  "    prefilter: human   # or 'automated (newsletter; reasons...)' — see below",
  "    ---",
  "    <full email body>",
  "",
  "Use the header lines as part of your decision. The framework already",
  "drops items the deterministic prefilter classified as automated /",
  "newsletter — if you ever see `prefilter: automated`, treat the item",
  "as already-classified noise and only do step 4 (mark task done).",
  "",
  "Your job:",
  "  1. Parse `inbox-item-id` from the first line of your task description.",
  "  2. The email body is already inline below the `---` — read it directly. Use `framework.inbox.read` only if you need fields the description doesn't carry.",
  "  3. Classify the item by calling the `triage.classify` tool:",
  "       curl -sS -X POST $BORINGOS_CALLBACK_URL/api/tools/triage.classify \\",
  "         -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
  "         -H 'Content-Type: application/json' \\",
  "         -d '{\"itemId\":\"<inbox-item-id>\",\"label\":\"<urgent|important|fyi|noise>\",\"reason\":\"<one short sentence>\"}'",
  "     The tool merges into `metadata.triage` (it does not clobber `metadata.email` / `crmLens` / etc.) and emits `triage.classified` for downstream apps.",
  "     Headers help: a `List-Id` or non-trivial `List-Unsubscribe` is a strong noise signal. `Auto-Submitted: auto-replied` is fyi/noise. A `Reply-To` that points to a real person can flip a `from: notifications@vendor` case toward `important`.",
  "  4. Mark your task done via `framework.tasks.patch`:",
  "       curl -sS -X POST $BORINGOS_CALLBACK_URL/api/tools/framework.tasks.patch \\",
  "         -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
  "         -H 'Content-Type: application/json' \\",
  "         -d '{\"taskId\":\"$BORINGOS_TASK_ID\",\"status\":\"done\"}'",
  "",
  "What you NEVER do (these are domain modules' job):",
  "  - Draft reply suggestions (inbox-replier or CRM does that)",
  "  - Match senders to CRM Contacts or any other entity store",
  "  - Create / modify / link CRM Deals or any other domain entity",
  "  - Emit user-facing Action cards (those are domain-specific UI)",
  "  - Auto-archive (out of scope)",
].join("\n");

const TRIAGE_SKILL = `# Inbox Triage Rubric

You are the triage agent. Classify every inbox item that arrives, but do
NOT take domain-specific actions — those belong to installed domain
modules (CRM, Support, Accounts, etc.) that subscribe to the same event.

This is the *first layer* in the layered inbox processing model: the
shell creates one inbox item per source event; this module adds a label
+ reason; domain modules then enrich the item with their own
interpretations.

## What you do

For each \`inbox.item_created\` event:

1. Read the inbox item via \`framework.inbox.read\`
2. Classify it into one of: \`urgent\`, \`important\`, \`fyi\`, \`noise\`
3. Write the label + reason back via \`triage.classify({ itemId, label, reason })\`
4. The tool emits \`triage.classified\` automatically — downstream modules (replier, CRM, etc.) react

## What you DON'T do

- **Draft reply suggestions** → \`inbox-replier\` (also pre-installed) or a domain-specific module like CRM
- **Match the sender to a CRM Contact / Customer / Employee** → CRM
- **Create / modify / link CRM Deals, invoices, HR records** → the relevant domain module
- **Auto-archive** → out of scope
- **Emit user-facing Action cards** → CRM-specific

## Classification rules

- **urgent** — needs the user to act in the next ~hour. Customer escalation, deal at risk, infra incident, calendar conflict affecting the next meeting, time-bounded ask from a known counterparty.
- **important** — needs the user to read + decide today, but not in the next hour. Vendor proposal, hiring update, board prep, active back-and-forth in a thread the user cares about.
- **fyi** — informational, no decision needed. Shipping confirmation, calendar accept from someone reliable, "thanks!" replies.
- **noise** — auto-archive material. Marketing blasts, duplicates of a previous thread, system notifications already surfaced elsewhere, unsubscribed-but-still-arriving lists.

When in doubt between two labels, pick the higher-attention one
(urgent > important > fyi > noise). False positives waste 30 seconds of
the user's time; false negatives miss decisions.

## Header signals

| Header | What it means |
|---|---|
| \`list-unsubscribe\` non-empty | Bulk mailer (newsletter or marketing) — usually \`noise\` |
| \`list-id\` non-empty | Mailing list — almost always \`noise\` |
| \`auto-submitted\` set to anything other than \`no\` | Auto-generated (vacation reply, calendar invite, system notice) — usually \`fyi\` or \`noise\` |
| \`precedence: bulk\` / \`list\` / \`junk\` | Bulk mailer; treat like list-unsubscribe |
| \`reply-to\` points to a real person while \`from\` is \`notifications@\` / \`noreply@\` | The vendor wants a reply — bump up to at least \`important\` |
| \`prefilter: automated (...)\` | The framework already classified this; you don't need to. Just close the task |
| \`prefilter: human\` | No deterministic signal fired — proceed with normal classification |
`;

interface TriageDeps {
  db: Db;
}

function buildLifecycle(deps: TriageDeps): ModuleLifecycle {
  // Same handler runs for explicit install AND new-tenant creation
  // — the agent + workflow + skill all need to land either way.
  const installHandler = async (ctx: { tenantId: string; moduleId: string }) => {
    const runtimes = (await deps.db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${ctx.tenantId} AND type = 'claude' LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    const runtimeId = runtimes[0]?.id;
    if (!runtimeId) {
      // eslint-disable-next-line no-console
      console.warn(
        `[inbox-triage] No Claude runtime for tenant ${ctx.tenantId}; skipping seed`,
      );
      return;
    }

    const rootRows = (await deps.db.execute(sql`
      SELECT id FROM agents
      WHERE tenant_id = ${ctx.tenantId} AND reports_to IS NULL
      ORDER BY created_at ASC LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    const rootAgentId = rootRows[0]?.id ?? null;

    await scrubInboxTriage(deps, ctx.tenantId);

    const agentId = randomUUID();
    await deps.db.execute(sql`
      INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, reports_to, created_at, updated_at)
      VALUES (${agentId}, ${ctx.tenantId}, ${TRIAGE_AGENT_NAME}, ${TRIAGE_AGENT_ROLE}, 'idle',
        ${TRIAGE_AGENT_INSTRUCTIONS}, ${runtimeId}, ${rootAgentId}, now(), now())
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
          title: "Triage inbox item: {{trigger.subject}}",
          description:
            "inbox-item-id: {{trigger.itemId}}\nsource: {{trigger.source}}\nfrom: {{trigger.from}}\nsubject: {{trigger.subject}}\n---\n{{trigger.body}}",
          originKind: "inbox.item_created",
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
      VALUES (${workflowId}, ${ctx.tenantId}, ${TRIAGE_WORKFLOW_NAME}, 'system', 'active',
        ${JSON.stringify(blocks)}::jsonb, ${JSON.stringify(edges)}::jsonb, now(), now())
    `);
  };

  return {
    onInstall: installHandler,
    onTenantCreate: installHandler,
    async onUninstall(ctx) {
      await scrubInboxTriage(deps, ctx.tenantId);
    },
  };
}

async function scrubInboxTriage(deps: TriageDeps, tenantId: string): Promise<void> {
  // FK chain: cost_events → agent_runs → agent_wakeup_requests → agents.
  // For workflows: workflow_runs → workflows.
  // tasks reference assignee_agent_id and created_by_agent_id; null those rather than delete.

  const agentFilter = sql`tenant_id = ${tenantId} AND name = ${TRIAGE_AGENT_NAME} AND role = ${TRIAGE_AGENT_ROLE}`;
  const workflowFilter = sql`tenant_id = ${tenantId} AND name = ${TRIAGE_WORKFLOW_NAME}`;

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

export const createInboxTriageModule: ModuleFactory = (factoryDeps: ModuleFactoryDeps) => {
  const db = factoryDeps.db as Db;
  const deps: TriageDeps = { db };

  const module: Module = {
    id: "inbox-triage",
    name: "Inbox Triage",
    version: "0.1.0",
    description:
      "Operations-persona agent that classifies every inbox item (urgent / important / fyi / noise) and writes a label via the triage tools. Auto-installed on every tenant.",
    provides: ["inbox-triage"],
    dependsOn: [{ capability: "inbox" }, { moduleId: "triage" }],
    defaultInstall: true,
    skills: [
      {
        id: "inbox-triage",
        source: "module",
        body: TRIAGE_SKILL,
        priority: 50,
        appliesTo: (event) => event.taskOriginKind === "inbox.item_created",
      },
    ],
    lifecycle: buildLifecycle(deps),
  };

  return module;
};
