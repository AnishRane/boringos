# Drive / Brain — running issue log

> Append-only diary of gaps found while exhaustively testing how Drive
> actually behaves as the "company brain." Each entry is dated, has a
> repro, and includes the smallest fix that closes the gap.

Repro environment: `pnpm dev` on port 3030, tenant `397cac55-19f3-44ad-9d34-16e1b5ea19bd`, user `parag.arora@gmail.com`, CRM 0.3.0 installed.

---

## 2026-05-30 — Session 1 findings

### 1. `shared/memory/` is not seeded at tenant creation

**What I expected:** every new tenant has an empty `shared/memory/MEMORY.md`
template waiting on disk, the same way each new user gets `users/<id>/memory/MEMORY.md`
and `users/<id>/preferences.md` scaffolded at signup.

**What I saw:** `.data/drive/<tenantId>/` had no `shared/` directory after
signup. The first agent that wrote to shared memory created the directory
itself. Before that, the brain has no physical scaffold at all.

**Cost:** new tenants look "blank" in the dashboard until an agent happens
to write to shared scope. Onboarding can't preview the structure.

**Fix:** in the tenant-creation hook (`packages/@boringos/core/src/boringos.ts`
around the per-tenant scaffold), also write a `shared/memory/MEMORY.md`
template via the DriveManager (so it also lands in the `driveFiles` index — see #4).

---

### 2. Specialist personas don't always update the index file (`MEMORY.md`)

**What I expected:** every persona that knows the Memory SKILL updates
both the entity file (e.g. `shared/memory/domains/acme.md`) *and* the
top-level `MEMORY.md` index when material new facts land.

**What I saw:**
- Copilot updated both `acme.md` and `MEMORY.md` after CRM onboarding (added "in CRM (ids in file)").
- Follow-up-writer appended an `## Activity` section to `acme.md` but **did not touch `MEMORY.md`**.
- Company-enrichment appended `## Enrichment` to `acme.md`, also **did not touch `MEMORY.md`**.

**Cost:** the index stops reflecting what the entity files say. Future
agents reading just `MEMORY.md` to decide whether to load detail files
miss recent activity / enrichment status. The brain looks staler than it is.

**Fix:** add a one-liner to every persona's SOUL.md: *"When you materially
update an entity file under `domains/`, also refresh the matching bullet in
`shared/memory/MEMORY.md` so the index reflects the change."* Or — cheaper
and more robust — a synthesis pass (see #7) that rewrites the index from
the entity files.

---

### 3. No synthesis / compaction routine

**What I expected:** something reads `tasks/*/log.md` and `*/notes/`,
promotes recurring facts into `decisions/` and `domains/`, and rolls
stale entries into `archive/`. Otherwise logs grow unboundedly.

**What I saw:** every run appends to `tasks/<id>/log.md` forever. Nothing
reads them again. They become a write-only cemetery. `task_24.md` says
this is "earned when daily logs consistently exceed a threshold" — it
isn't built. With concurrency-5 and active fanout (1 user action → 7
derived tasks in this test) the log volume ramps fast.

**Cost:** unbounded growth; brain doesn't actually learn from its own history.

**Fix:** a scheduled routine ("synthesize-memory") that runs once a day,
loads recent task logs + current MEMORY.md, and asks an agent to propose
promotions/archives. Implement as a smart routine targeting a workflow
so it only fires when the log volume warrants.

---

### 4. Dashboard drive list is incomplete — 8/10 files invisible to the user

**Repro:**
```bash
curl -s http://localhost:3030/api/admin/drive/list \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT"
# → 2 files

find .data/drive/$TENANT -type f | wc -l
# → 10
```

**Root cause:** `admin-routes.ts:1997` queries the `driveFiles` Postgres
table only. Three writers bypass that index:

1. `scaffoldDrive` at signup — writes `users/<id>/preferences.md` and
   `users/<id>/memory/MEMORY.md` direct to FS.
2. Auto-checkpoint hook (`packages/@boringos/agent/src/memory-checkpoint.ts`)
   appends `tasks/<id>/log.md` direct to FS, doesn't insert into `driveFiles`.
3. Agent `Edit`/`Write` on the workdir symlink — partially covered by the
   checkpoint's memory-reindex (only walks `**/memory/**`), so `shared/memory/*`
   gets picked up, but any non-memory shared file (e.g. `shared/playbooks/X.md`)
   would not.

**Cost:** users open Drive in the dashboard and see "near-empty tenant"
even though the brain has grown. Looks broken; isn't.

**Asymmetry:** `GET /api/admin/drive/file/<path>` reads the filesystem
directly and returns 200 for every path I tried — so content is consistent,
only the listing is missing.

**Fix (any of):**
- Have `scaffoldDrive`, `memory-checkpoint`, and agent FS writes all go
  through `DriveManager.write(...)` so the index stays authoritative.
- Add a session-end reconciler that walks the FS slice and upserts any
  file not in `driveFiles`.
- Or change `/drive/list` to scan the filesystem and join with the index.

The reconciler is the smallest patch.

---

### 5. No curator / write-conflict normalization

**What I expected:** with `queue.concurrency: 5` (the dev default), two
agents could write to the same shared-memory file simultaneously. Some
form of file lock, last-writer-wins-with-merge, or curator agent that
normalizes the result.

**What I saw:** the engine has nothing for this today. In this test no
two concurrent runs happened to touch the same file, but the CRM fanout
spawned 4 simultaneous runs on the same parent task, and each of those
sub-runs (enrichment, deal-analysis, etc.) is now licensed to write to
`shared/memory/domains/acme.md`. A future test with timing-sensitive
writes will tear this.

**Fix:** the cheap version is a Drive-level advisory lock on
`shared/memory/**` (single-writer queue per path). The right version is
a curator agent that periodically reads recent writes and resolves drift.

---

### 6. Host CLI's skills bleed into agent context

**What I saw:** agent's transcript reports `skills: [frontend-design, neuro-copy, pmf-positioning, viral-launch, deep-research, …]` — these are skills installed on the **host user's** Claude CLI (mine), not the BoringOS-composed skills. The framework's system prompt dominates so behavior was fine, but a curious agent could call `/pmf-positioning` mid-task and waste tokens, or worse, leak workflow-shape information across tenants.

**Fix:** the runtime invokes `claude` with the user's `~/.claude/` as the
home dir. Override `CLAUDE_HOME` (or whatever the CLI uses) to point at a
per-run isolated directory so only BoringOS-composed skills/agents
appear. May not be possible without CLI cooperation; in that case,
document it and ship a smoke test that detects bleed.

---

### 7. Email path not idempotently testable without OAuth

**What I saw:** `google.gmail.send_email` returns
`{ok:false, code:"not_found", message:"Google account not connected"}`
until OAuth completes. Per-tenant connection state lives in
`/api/connectors`. There's no local mock SMTP, no "dry-run" mode that
records the would-be email to `drive/me/outbox/`, and no Resend
fallback path exposed as a tool.

**Cost:** can't write integration tests for the "agent received customer
email → updated brain → drafted reply" flow without a real Google
account in the loop.

**Fix:** ship a `dev-mail` provider that satisfies the same Tool
contract, writes outbound mail to `shared/outbox/<msgId>.eml`, and reads
inbound from `shared/inbox-dropbox/` (a directory the test harness can
populate). Enabled by `BORINGOS_MAIL=dev` env.

---

### 8. `POST /api/admin/inbox` doesn't emit `inbox.item_created`

**What I expected:** the seed endpoint is comment-described as "for demo
seeds and any caller that wants to push a synthetic inbound item without
wiring a connector" (admin-routes.ts:2247). I would expect parity with the
Gmail forward-sync path — i.e. after the row is inserted, the same
`inbox.item_created` event fires on the event bus so the inbox-triage
workflow picks it up.

**What I saw:** the route just inserts and returns the row. The triage
workflow (which triggers on `inbox.item_created`, see
`packages/@boringos/core/src/modules/inbox-triage.ts:172`) never sees it.
Item sits `status=unread, linkedTaskId=null` forever; no triage, no reply
draft, no brain update.

**Cost:** the only way to integration-test the email → brain pipeline
today is to have a real Gmail account connected. Demo seeds for sales
calls / onboarding screens are dead-end items.

**Fix:** after the `db.insert` in admin-routes.ts:2255, publish the same
event the forward-sync emits (`{ type: "inbox.item_created", tenantId,
itemId, source, sourceId, subject, body, from, automated: { automated: false } }`).
One additional `eventBus.emit(...)` call; the rest is already wired.

---

### 9. Agent FS sandbox covers the whole framework — tenant isolation is policy, not posix

**Severity:** high (multi-tenant breach surface)

**What I expected:** the agent process is `chroot` / `unshare(--mount)` /
namespace-jailed into its workdir so the only readable `./drive/` content
is the symlinks the framework set up — `me/`, `shared/`, `tasks/`,
`users/<me>/`. Anything outside is invisible.

**What I observed (real session, run `9939d6c1-...`, task BOS-004):** when
my `./drive/...` reads through the symlink mount started getting flaky
(probably bash subshell quirk), the agent **resolved the symlinks to their
absolute backing paths and read those directly**:

```
Read: /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework/.data/drive/397cac55-…/shared/memory/MEMORY.md
Read: /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework/.data/drive/397cac55-…/shared/memory/domains/acme.md
```

That's the **tenant data root**. The agent process is launched with
`--dangerously-skip-permissions` and cwd inside `.data/agent-workdirs/<task>/`.
Its parent dir is `.data/`, sibling of `.data/drive/`, and the whole
filesystem above is readable too. A curious or compromised agent can:

```
ls /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework/.data/drive/
# → every tenant's brain
cat .../.data/drive/<other-tenant-id>/shared/memory/MEMORY.md
```

**Cost:** the entire "tenant privacy is the Drive's job" claim
(`docs/blockers/task_24…md`) is *aspirational, not enforced*. ACLs on
`drive.read` / `drive.write` tools and on `GET /api/admin/drive/*` are
real. The filesystem mount is not.

**Fix options:**
1. **Posix sandbox per run** — Linux: `unshare -mU` + bind-mount the
   tenant's drive slice as the *only* visible filesystem under
   `./drive/`. macOS: `sandbox-exec` profile that restricts reads.
   Heaviest but real.
2. **chroot the workdir** to a per-run staged directory whose only
   accessible parent is `./drive/` (the symlinks). Don't put workdirs
   under `.data/`.
3. **Move tenant drive data outside the framework cwd** — e.g.
   `/var/lib/boringos/drive/<tenantId>/`, and run the dev server from
   a parent that doesn't contain it. Doesn't fix the leak but reduces
   the discovery surface.
4. **Audit / runtime guard** — wrap the runtime's CLI invocation in a
   filter that scans tool inputs for absolute paths under
   `<framework-root>/.data/drive/<OTHER-TENANT>/` and refuses them.
   Defense-in-depth but not a real boundary.

Option 1 is the only real fix. The rest are bandaids.

**Also affects the indexer:** writes done via absolute-path Edit/Write
bypass even the `**/memory/**` reindex hook in the auto-checkpoint
(see #4). So the agent that took the escape hatch also evaded the
mechanism that keeps the dashboard list honest.

---

### 10. Stale `running` run rows that never finalize

**Repro:** task BOS-004 has 8 runs in `agent_runs`. Run `7c01db35` was the
first run on that task (started 19:11:25). Later runs (`52ff3d8b`)
completed normally and finalized at 19:16:05. The earlier run row stayed
`status=running, finishedAt=null` indefinitely even though:

- the auto-checkpoint hook wrote its log entry,
- the result-comment was auto-posted on the task,
- a claude subprocess is still in `ps` (PID 25901, 0.8% CPU, idle),
- the task progressed and spawned fanout downstream.

**Hypothesis:** the run stayed alive because the framework's
auto-rewake cascade re-entered the same task while the first run's
final-finalize callback was in flight, and the new run was tracked
under a new id while the original row was never explicitly closed.
Either an event was dropped or the engine never reaches the
"if I'm not the latest run on this task, mark myself done" branch.

**Cost:** dashboards show a permanently in-progress run; budget /
spent accounting may double-count; `recoverPending()` only sweeps
on boot, so until the dev server restarts the row is wrong.

**Fix:** add a per-task generation guard — when a wake creates a new
run on a task that already has a `running` row from the same agent,
either coalesce (preferred — already the doc'd behavior) or mark the
older row as superseded (`status=replaced`, `finishedAt=now()`).

---

### 11. Brain-write is sometimes gated as an `agent_action` task awaiting approval

**Observation, not bug — but the "obvious development per task" framing
glosses over it.** In the BOS-004 cascade, the copilot proposed a task
`f50720b1: Log Sarah Lin as renewal decision-maker + Q4 vendor-consolidation`
with `originKind: agent_action, nextActor: human`. The brain
update **didn't happen from the copilot.** It happened later — and
automatically — when the auto-fanned `contact-enrichment` agent ran
and wrote the `## New stakeholder` section to `shared/memory/domains/acme.md`.

**Why this matters:** if the user disabled CRM (or no contact was
created), the proposed brain-write would sit forever in the approval
queue and the brain would NOT grow. The reliable brain-update path
runs through CRM → enrichment fanout, not through the persona writing
shared memory directly.

**Fix (choice):**
1. Document this explicitly in the Memory SKILL — "for shared facts
   that don't need approval, write directly; gate only PII / external
   actions."
2. Or make memory-write a non-gated category of `agent_action`
   (auto-approve "write to `shared/memory/domains/**`" unless flagged).
3. Or accept the gating and lean on the auto-fanout pattern for brain
   growth — but ship a non-CRM equivalent (a "memory curator" agent
   that fires on `task.completed` events and promotes findings).

---

### 12. Symlinked `./drive/me` reads occasionally fail through bash subshells

**Observation:** mid-run, the BOS-004 copilot suddenly couldn't read
`./drive/...` through `Bash` (`cat ./drive/me/memory/MEMORY.md`
returned errors / the `curl` chains stopped working), and the agent
fell back to absolute paths (see #9). After ~5 retries it recovered.

**Possible cause:** bash subshell + symlink resolution interacting
with macOS APFS, or environment-variable expansion failing inside a
heredoc. Worth a smoke test in CI on Linux + macOS that re-runs
50 reads through `./drive/` from inside a heredoc Bash op and
counts failures.

---

## What works well (so we don't lose this)

- `Read`-before-`Write` discipline holds across 3 different personas
  (copilot, follow-up-writer, contact-enrichment).
- Auto-fanout chain — CRM create → enrichment → brain-write —
  produces real cross-linked memory without explicit user prompting.
- Memory SKILL discipline travels with the module, not the persona.
- `**/memory/**` re-index hook does keep `/api/admin/drive/list`
  current for memory paths (the FS-Edit writes from the
  enrichment agent ARE reflected in the dashboard after the run).
- Result comment + auto-checkpoint log give the user a reliable
  end-of-run trace even if intermediate steps were chaotic.

---

### 13. Tenant signup doesn't seed a `runtimes` row → silent install failures

**Severity:** high (silent feature loss).

**Repro:**
1. Sign up a new user → tenant gets created
2. Built-in modules auto-install on tenant create
3. Check `runtimes` table for the new tenant: **empty**
4. Modules that gate on "is there a claude runtime?" silently no-op.

**Concrete breakage observed in this session:** the `inbox-triage`
module's `installHandler` runs:

```ts
const runtimes = await db.execute(sql`
  SELECT id FROM runtimes WHERE tenant_id = ${ctx.tenantId} AND type = 'claude' LIMIT 1
`);
const runtimeId = runtimes[0]?.id;
if (!runtimeId) {
  console.warn(`[inbox-triage] No Claude runtime for tenant ${ctx.tenantId}; skipping seed`);
  return;
}
```
(`packages/@boringos/core/src/modules/inbox-triage.ts:226-235`)

So the "Triage incoming inbox items" workflow + triage agent never
got created, even though the module reports `installed`. Visible
only in dev-server console; not surfaced anywhere the operator
can see.

**Cascading effect:** real Gmail came in via forward-sync,
`Enrich inbox items on ingestion` workflow fired and added
`crmLens.pendingLead` metadata — but the *triage* workflow that's
supposed to wake the triage agent and produce a draft reply never
existed, so the email sat `unread, linkedTaskId=null` indefinitely.

The system-wide pattern: any module with `if (!runtime) return` is a
silent loss. Other built-ins likely have similar guards.

**Fix:**
1. Insert a `runtimes` row (`{type: 'claude', name: 'Claude', isDefault: true}`)
   in `onTenantCreated` **before** any modules' `installHandler` fires.
2. Have `installHandler`s upgrade their no-runtime branch from
   `console.warn(...); return;` to either (a) throw so install fails
   loudly, or (b) register a "needs-runtime" deferred state that
   auto-completes when a runtime is later added.
3. Smoke test in CI: signup → list workflows → assert every
   `defaultInstall: true` module's workflows are present.

**Manual workaround (used in this session):**
```bash
curl -X POST .../api/admin/runtimes -d '{"name":"Claude","type":"claude","config":{}}'
curl -X POST .../api/admin/modules/inbox-triage/install
curl -X POST .../api/admin/workflows/<triage-id>/execute -d '{"payload":{...email...}}'
```
After that the triage workflow appeared and execute-against the
existing email succeeded.

---

### 14. Forward-sync ingests our own SENT mail as if it were inbound — runaway fanout

**Severity:** high (real money + brand risk).

**Repro:**
1. Connect Gmail; let user have a "Send Mail As" alias (`parag@revelin7.com`
   on `parag.arora@gmail.com` in this session).
2. Agent drafts a reply, user approves, `crm.email-lens` sends it via
   `gmail.send_email`.
3. Gmail stores the message with label `SENT` in the user's mailbox.
4. Forward-sync's next tick pulls it back into the BoringOS inbox
   alongside real inbound.

**What happened in this session:** the agent's outbound reply to Talker
came back in under `from: Parag Arora <parag@revelin7.com>` (the
Send-As alias), subject `Re: Please send the proposal`,
`gmailLabels: ["SENT"]`. The triage workflow promptly:
- classified it `important` ("active proposal thread"),
- created CRM company `Revelin7 (revelin7.com)`,
- created CRM contact `Parag Arora <parag@revelin7.com>`,
- spawned `Enrich contact`, `Enrich company`, and `Analyze new deal` runs
  on the agent's own message,
- queued ANOTHER reply draft (a reply to itself).

**Cost:**
- token burn on enrichment for an entity that doesn't exist (Revelin7
  is the user's Send-As alias, not a customer),
- CRM bloat with phantom records,
- a real possibility of an agent reply-loop if `gmailLabels: SENT`
  isn't filtered out of the eligible-for-reply set,
- ANY user with a custom-domain alias on Gmail will hit this on
  day one.

**Existing partial mitigation:** the forward-sync prefilter checks
`auto-submitted`, `list-id`, `precedence` — none of which are set on a
human-drafted email sent via the Gmail API.

**Fix (mandatory):**
1. In the forward-sync ingestion path, **drop messages whose
   `gmailLabels` include `SENT`** (or any other label set indicates
   the user is the sender). They belong in a separate
   `outbox-mirror` lane if we want to record them at all.
2. Also drop messages whose `From` matches any verified Send-As
   alias on the connected account (use Gmail's `/profile` + the
   `sendAs` endpoint to enumerate aliases at connect-time, cache in
   `connector_accounts.profile.sendAs`).
3. Defensive: at the inbox-replier workflow's trigger condition,
   skip any `triage.classified` event whose source item has
   `gmailLabels` including `SENT`. Defence in depth even if (1)+(2)
   leak.

**Related — surfaced in the same cascade (good, not a bug):** the
agent did spawn a `human_todo: Confirm: is parag@talker.network your
own record? Tag or merge to keep` task once it noticed the duplicate
shape, so the loop-detection instinct exists — it's just too late
to prevent the wasted runs that already fired.

---

## Next things to test (queued)

- [ ] Does the agent automatically extract facts from inbound emails and
      update `shared/memory/domains/<entity>.md`?
- [ ] When the user @-mentions a known entity in a copilot message, does
      the agent route to the right `domains/` file *before* answering?
- [ ] Cross-tenant isolation: confirm a second tenant cannot read
      tenant A's drive even with a forged path.
- [ ] What happens if an agent writes to a path outside its ACL
      (e.g. follow-up-writer writes to `users/<other-user>/memory/`)?
      Hard error, silent skip, or success?
- [ ] Recall behaviour when no Hebbs API is configured — the drive-backed
      provider only does grep+recency. How does it rank?
- [ ] Memory growth under concurrent writes to the same entity file
      (race condition #5).
