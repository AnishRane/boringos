# Task 25 — Drive-backed memory: deferred gaps

## Status

NOT STARTED. Parked from the task_24 follow-up session on 2026-05-12.

The session shipped task_24 (drive-backed memory + SKILL + auto-
checkpoint + per-user signup scaffolding) and immediately closed the
three highest-impact gaps that surfaced in live testing:

- **G1 (auto-checkpoint logs are blank)** — fixed. Checkpoint now
  reads `agent_runs.stdoutExcerpt`, parses the stream-json `result`
  event, and embeds the agent's actual reply in the log entry
  (bounded at 4 kB). Falls back to errorMessage / placeholder.
- **G2 (memory writes invisible to drive.search)** — fixed. After
  each run, the checkpoint hook walks `users/<owner>/memory/` and
  `shared/memory/` and upserts any file with `mtime >= run.startedAt`
  into `drive_files`. Agent FS writes via the mount now show up in
  the same index that `drive.search` queries.
- **G4 (silent mount failures)** — fixed. `engine.ts` now logs a
  loud `console.warn` when `injectDrive` throws instead of silently
  falling back to tool-only access.

This task captures the **remaining gaps** in priority order. None
are load-bearing today; they each represent a real edge that will
matter at scale or under adversarial use.

## 1. The principle

Once the agent has a real filesystem (task_23) and an opinionated
layout + SKILL + checkpoint (task_24), most remaining issues are
about **adherence verification**, **concurrency**, and **lifecycle
hygiene**. They don't break the architecture; they bound how far
we can scale before the cracks show.

## 2. Gap inventory

### G3 — SKILL adherence is unenforced

The new SKILL contains a cardinal rule: *"When the user says save/
remember/note/from now on/always — you MUST write a file before
responding."* If the agent ignores it (says "saved" without a
`Write` call), nothing catches it. The only signal is the divergence
between the agent's reply text and the filesystem state.

**Why it matters:** Gap 1 from the original session ("agent lied
about saving") is now mitigated by the SKILL + tool-prompt hide
list, but it's not mechanically prevented. A regression in the
system prompt or a future model swap could re-introduce the
behaviour and we'd have no audit signal.

**Fix shape:** at `agent.run.finished`, compare the agent's reply
text (already extracted by the G1 checkpoint) against the runs's
filesystem write set (already computable from G2's reindex pass).
If the reply contains save-intent phrases (`saved`, `remembered`,
`from now on`, `noted`) AND no `users/<owner>/memory/**` write
happened in this run AND no `shared/memory/**` write happened,
log a warning + post a QA comment on the task. Heuristic-only —
false positives are fine; the goal is to surface drift.

**Effort:** ~50 lines, including the regex and the run-level
write-set extraction. Test with synthetic transcripts.

### G5 — Concurrent `MEMORY.md` race

Two parallel agent wakes for the same user could both:

1. Read `MEMORY.md`
2. Append a pointer
3. Write `MEMORY.md`

…with one overwriting the other's append. No file-level locking
today. The default queue has `concurrency: 5`, so this is reachable
the moment a user double-types or two routines fire near-
simultaneously.

**Why it matters:** silent data loss in the index. The detail files
under `decisions/` and `domains/` are unique per filename and don't
collide; only `MEMORY.md` does.

**Fix shape:** atomic write-and-rename — write to `MEMORY.md.<runId>`,
then `rename()` over `MEMORY.md`. Loses one append but never
corrupts. Or use an in-process mutex keyed on `<tenantId>:<scope>`
that serialises MEMORY.md writes for the same scope across all
in-flight runs. The mutex is correct, the rename is simple. Pick
one.

**Effort:** ~80 lines + race-condition test.

### G6 — Cross-session continuity not verified end-to-end

The task_24 follow-up session did a live test that proved
single-session memory writes work (Talker.Network landed in
`shared/memory/notes/`). The "day-2" test — open a fresh copilot,
ask the agent without any in-session context whether it knows your
preferences — wasn't completed because driving the Claude CLI from
the test session isn't feasible.

**Why it matters:** the whole point of memory is cross-run, not
within-run. We have unit tests that prove the bytes land correctly,
but no integration test that proves the agent actually reads them
on a fresh wake and acts on them.

**Fix shape:** integration test that boots BoringOS, signs up a
user, calls `framework.agents.wake` with a task containing
"remember I prefer terse responses", waits for finalisation,
verifies the file landed, then wakes the same agent on a NEW task
with a fresh sessionId asking "what are my preferences?", and
asserts the reply references the file. Requires actual Claude CLI
or a mock runtime that simulates the read.

**Effort:** ~150 lines + needs a mock CLI runtime that asserts on
`Read` tool calls. Or: real Claude calls behind a `NODE_ENV=test`
gate that's skipped in CI.

### G7 — Background compaction never runs

`MEMORY.md` and `notes/` only grow. The SKILL tells the agent to
archive proactively when the index swells, but it's reactive — the
agent only acts on it when reading MEMORY.md during a wake, and
only if it notices. Pre-existing `notes/` from a year ago accumulate
forever.

**Why it matters:** the prompt cost of reading MEMORY.md on every
wake grows linearly with un-archived entries. Once it crosses ~10 kB
the per-token cost dominates and recall quality degrades.

**Fix shape:** a "memory compactor" routine that wakes weekly per
tenant. Persona reads each user's MEMORY.md + tenant-shared
MEMORY.md, identifies entries older than N weeks with no recent
references, moves them to `archive/<topic>.md` and removes the
pointer. Standard agent task — just plumbed via the existing
routine scheduler.

**Effort:** ~200 lines (persona bundle + routine wiring + tests).
Not urgent until corpus exceeds ~50 entries per user.

### G8 — Sibling-user isolation untested in live wake path

`drive-acl.test.ts` proves the ACL rule. The mount design (task_23)
proves the symlink shape. But we don't have an end-to-end test that
proves: user *A*'s agent wake cannot read user *B*'s preferences
file at runtime.

**Why it matters:** privacy. The unit tests cover the policy; the
integration gap is whether the wiring delivers the policy. A future
regression in `wake-context.ts` or `drive-mount.ts` could leak
data without breaking the existing unit tests.

**Fix shape:** integration test — sign up two users in the same
tenant, give user A a private preference, wake the same agent on a
task owned by user B, assert the reply doesn't contain A's
preference. Manual version: 5 min. Automated version requires the
mock CLI from G6.

**Effort:** ~80 lines (sharing the runtime mock from G6).

### G9 — Notes/ accumulation in a chatty session

Each `memory.remember` writes a file in `notes/`. A single copilot
session that records 20 small observations leaves 20 files in
`notes/`. Without an obvious "this is yesterday's notes" boundary,
the agent has to grep to recover context.

**Why it matters:** UX clarity. The agent CAN find it via grep, but
"what did I learn yesterday in this session" should be one read.

**Fix shape:** per-session note bundling — group writes within a
single sessionId into a daily file: `notes/<sessionId>/<date>.md`
appended-to instead of one-file-per-write. Or just append everything
in a session to the existing session log (G1 already established
the session log path).

**Effort:** small (~40 lines), but conflicts with `memory.remember`
returning a unique `memoryId`. Need to decide the API trade-off.

## 3. Priority recommendation

| Gap | Priority | Effort | Trigger to fix |
|---|---|---|---|
| G3 — SKILL adherence audit | medium | 50 lines | After observing one regression in agent behaviour |
| G5 — MEMORY.md race | medium | 80 lines | First user reports a "lost note" |
| G6 — cross-session E2E test | medium | 150 lines | Before any major prompt/SKILL refactor |
| G7 — compactor routine | low | 200 lines | When average MEMORY.md exceeds 10 kB |
| G8 — sibling isolation test | medium | 80 lines | Before opening to multi-user tenants in prod |
| G9 — notes bundling | low | 40 lines | When notes/ exceeds 100 files per user |

## 4. Touch list (when work resumes)

- `packages/@boringos/agent/src/memory-checkpoint.ts` — extend for
  G3 (adherence audit) and G5 (mutex on MEMORY.md writes)
- `packages/@boringos/agent/src/personas/memory-compactor/` — NEW,
  for G7
- `packages/@boringos/runtime/src/runtimes/mock-cli.ts` — NEW
  fixture runtime for G6 + G8 integration tests
- `packages/@boringos/memory/src/drive.ts` — extend for G9 if we
  switch `memory.remember` to append-to-day-file

## 5. Status log

- 2026-05-12 — task drafted; G1/G2/G4 shipped, G3/G5/G6/G7/G8/G9
  deferred. None are blocking for the demo path.
