# Blocker — Thread-aware inbox: stop triaging your own outbound, triage threads not messages

## Problem

Three related symptoms surfaced when looking at the
"Re: Invoice for April" thread:

1. **Outbound emails get ingested + triaged.** The Gmail sync
   workflow uses `query: "newer_than:15m"` with no `-from:me`
   filter. Gmail's search corpus includes the user's `Sent`
   folder, so every reply the user sent through Gmail (or via
   Hebbs's composer) flows back into `inbox_items` and gets
   classified by the triage agent. 3 of 26 current rows are
   `from: parag@revelin7.com` — the connected user himself.

2. **Each message in a thread becomes its own inbox row, each
   gets triaged independently.** The "Invoice for April"
   conversation is 5 rows: 3 from Atul, 2 from the user, every
   one with its own `source_id` (Gmail's per-message id), every
   one classified separately. Five distinct triage rationales for
   one conversation. The agent generates summaries based on
   whichever individual reply it happens to be triaging — often
   not the latest one — because to the agent each row is an
   isolated message.

3. **Triage agent's task description is one message in isolation.**
   Looking at `apps/generic-triage/src/workflows/triage-on-inbox.ts`,
   the task description is just `from + subject + body` for that
   one message. The agent never sees the thread, never knows
   there's a "latest reply." So even when triage triggers on the
   latest message, the agent's reasoning is about that single
   message's body alone — and quoted history below the new reply
   is what most LLMs end up summarizing because it has more
   tokens.

The shell's inbox UI *does* group by thread (Phase A6's
`groupByThread` in `Inbox/presenter.ts`), but only at display
time. The agent layer is upstream and works per-row.

## The decisions

### A. Default to skipping your own outbound

Add `-from:me` to the sync query. The user's own sent mail
doesn't need an inbox row — they sent it, they know about it,
Hebbs has its own audit (`metadata.sentReply` stamped by the
composer when the user clicks Send via the Reply Composer).

Edge: replies the user sends through Hebbs go to Gmail's Sent
folder. With `-from:me` they don't come back through ingest. Good
— that prevents the loop where Hebbs would re-ingest its own
sends and re-triage them.

Tenant policy override later — some tenants might want to track
"how often does the human reply" for analytics. Park it under
`tenant_settings` (`inbox.ingestOutbound = true`), default OFF.
That belongs to the admin settings UI in `task_04`, not here.

**Out of scope of this blocker:** retroactively delete the 3
existing outbound rows. They're noise but cheap to leave; the
inbox UI can filter them via a follow-on shell change if needed.

### B. Triage at the thread level

Each new message that lands in an existing thread must:

1. Mark earlier same-thread inbox items as `superseded` (new
   `inbox_items.status` value, joining `unread / read / snoozed
   / archived`).
2. Trigger triage **only on the latest** message; the agent
   reasons about the conversation, not just the new chunk.
3. Show the latest message's `metadata.triage` to the user when
   the thread is collapsed (the existing UI helper
   `groupByThread` already picks `thread.latest`, so this is
   automatic once the latest item carries the triage block).

The conversation is the unit; per-message rows are an
implementation detail of how Gmail delivers content.

#### Why "supersede" not "delete"

- Audit: someone might want to see every message that ever came
  in on a thread. Soft-status preserves the history.
- Reverse-sync round trip (Gmail → Hebbs): when the user reads
  message N+1 in Gmail, we want to flip the *thread* to read
  in Hebbs. Easier to reason about when prior messages still
  exist in the DB but are flagged as superseded — they don't
  show up in the active inbox view but the join is intact.

#### What the new status excludes

A `superseded` item:
- Is not shown in unread / read / snoozed tabs (only the latest
  per thread shows there)
- Is not shown in archived (archive is for explicit user action)
- Is excluded from agent triage queues (no new triage runs)
- Is reachable when the user explicitly opens the thread detail
  pane, where the historical messages render in chronological
  order (this is the existing thread-view code we wrote in
  Phase A6 / Inbox D-batch — needs the query updated to include
  `superseded` rows for the selected thread)

### C. Triage agent sees the thread, not just the message

When the workflow fires for an inbox item that's part of an
existing thread (thread has > 1 message), include a brief
summary of the prior messages in the task description so the
agent triages the conversation, not the latest delta.

Format the task description like:

```
inbox-item-id: <uuid>
source: google.gmail
from: <latest sender>
subject: <subject>
thread-length: 3
---
[Latest message body — verbatim]

--- Prior messages in this thread (oldest → newest) ---

From <sender>, <date>:
<body, summarized to 500 chars max>

From <sender>, <date>:
<body, summarized to 500 chars max>
```

The agent should classify based on the **conversation state**,
not just the new chunk. Notably:

- A reply that says *"thanks, looks good"* on a thread that
  started with a $50K deal proposal is still a "reply" in the
  CRM sense, not a generic ack — context matters
- An auto-reply / out-of-office on an internal thread shouldn't
  flip the whole thread to "newsletter"

## Implementation outline

### Step 1 — Sync query excludes self

`packages/@boringos/connector-google/src/default-workflows.ts`,
the `googleGmailSync` workflow's `fetch` block:

```diff
- query: "newer_than:15m"
+ query: "newer_than:15m -from:me"
```

That's it. Gmail's search syntax handles the `-from:me` token
natively. No DB or schema change.

### Step 2 — `superseded` status + supersede on ingest

#### Schema

`packages/@boringos/db/src/schema/inbox.ts` — add `superseded`
to documented status values (it's a `text` column, no enum, so
no migration needed). Document in the comment.

#### Logic

`packages/@boringos/workflow/src/handlers/create-inbox-item.ts`:
after inserting a new item with a `metadata.threadId`, run:

```sql
UPDATE inbox_items
   SET status = 'superseded', updated_at = now()
 WHERE tenant_id = $1
   AND source = 'google.gmail'
   AND metadata->>'threadId' = $2
   AND id <> $newItemId
   AND status NOT IN ('archived', 'snoozed')
```

(Leave archived + snoozed alone — those are explicit user
states.)

#### Trigger filter

The `inbox.item_created` event currently fires after every
insert. Triage workflow's trigger filters to `source =
'google.gmail'`. Add an additional filter so triage skips
`superseded` items — but actually, `create-inbox-item` only
fires the event for the NEW row, and the new row is never
superseded itself, so this is automatic. The OLD rows that get
flipped to superseded wouldn't re-trigger anything because they
were already triaged before. Skip this filter; not needed.

### Step 3 — Tabs hide superseded

`packages/@boringos/shell/src/screens/Inbox/index.tsx` and the
admin `GET /inbox` endpoint:

- The list query needs `WHERE status = $tab` — superseded never
  matches `unread / read / snoozed / archived`, so it
  automatically falls out of every tab.
- The thread-detail pane (`InboxDetail.tsx`) already calls
  `groupByThread` to bucket items. Today it pulls from the same
  status-scoped list. Change: when a thread is opened, fetch all
  items with the same `threadId` regardless of status (so the
  user sees the full conversation history). Server-side: add a
  `?threadId=X` query param to `GET /inbox`.

### Step 4 — Thread-aware triage task description

`apps/generic-triage/src/workflows/triage-on-inbox.ts`:

The current `create-task` block uses
`{{trigger.body}}` and `{{trigger.from}}` — fields the
`inbox.item_created` event payload provides for ONE message.

To include thread context, the workflow needs access to all
items in the thread. Two options:

- **Easy:** add a new workflow block `fetch-thread` that takes
  `threadId` and queries `inbox_items` for prior messages,
  returning a synthesized thread summary string. Feed that into
  the triage task description.
- **Easier still:** have `create-inbox-item` enrich the emitted
  event with a `threadSummary` field built from the same
  `UPDATE` query in step 2. Triage workflow templates
  `{{trigger.threadSummary}}`.

Recommend the second — single block change, no new handler.

### Step 5 — Update the triage agent's instructions

`apps/generic-triage/src/agents/triage.ts`'s `instructions`
field already says "read the email body inline." Append a
section telling it to read the thread summary if present and
classify the conversation, not the new message.

## Schema impact

- `inbox_items.status` text values now include `superseded` —
  no DDL change (column is plain text).
- `metadata.threadId` is already populated by
  `connector-google` for Gmail messages (verified in DB —
  recent rows have it).
- No new columns, no new tables.

## Files in scope

- `packages/@boringos/connector-google/src/default-workflows.ts` — sync query
- `packages/@boringos/workflow/src/handlers/create-inbox-item.ts` — supersede + emit threadSummary
- `packages/@boringos/db/src/schema/inbox.ts` — comment update
- `packages/@boringos/core/src/admin-routes.ts` — `GET /inbox?threadId=` for the detail pane
- `packages/@boringos/shell/src/screens/Inbox/InboxDetail.tsx` — fetch full thread when detail opens
- `apps/generic-triage/src/workflows/triage-on-inbox.ts` — task description includes thread summary
- `apps/generic-triage/src/agents/triage.ts` — instructions mention thread context
- `tests/phase23-thread-triage.test.ts` (new) — supersede correctness, exclusion of self-from, thread summary in agent prompt

## Why this matters

Without this, every email-driven flow Hebbs ships gets noisier
the more the user actually uses email. A 10-message thread today
generates 10 triage runs, 10 draft tasks, 10 inbox rows — most of
them with stale or contradictory rationales. Tenants stop trusting
the triage column. Cost compounds. The "agent looks at email"
promise quietly degrades into "agent looks at fragments and
guesses."

The two-pane inbox UI we built treats threads as the unit. The
agent layer needs to match.

## Build order

1. Sync query exclude `-from:me` — one line, ship today
2. Supersede on ingest — server-side change, takes a re-test
3. Inbox detail pane fetches by threadId — depends on #2
4. Thread summary in triage task description — depends on #2
5. Triage skill markdown update — touches no code paths
6. Tests — last

## Open questions

- **What about non-Gmail sources?** Slack threads have a
  `thread_ts`. Future Notion / Linear / etc. each have their own
  notion of a thread. The `metadata.threadId` field is generic
  enough; sources just need to populate it. Out of scope for
  this PR but worth flagging in the doc.
- **The 3 historical outbound rows** — leave them, or backfill-
  delete? Lean leave; they don't break anything and a user might
  benefit from the audit. Hide via the inbox tab filter if needed.
- **Replies the agent sends** (after task_07's approve+execute
  flow). Those come back via `in:sent` too. Same `-from:me`
  filter handles them.
- **What if Gmail puts the user's draft in a non-Sent folder
  (Drafts)?** `from:me` matches based on the sender header, not
  folder — drafts have a sender of you, so they'd be excluded
  too. That's fine; we don't want to triage drafts.
