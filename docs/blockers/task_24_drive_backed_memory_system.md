# Task 24 — Drive-backed memory system

## Status

NOT STARTED. Depends on task_23 (drive must be mounted into the
agent workdir as a real filesystem before this is implementable).

## 1. The principle

**Memory belongs to humans and to orgs. Agents are consumers of
memory, not holders.** Anything worth surviving an agent rotation
belongs at user or tenant level by definition — and if you can
delete an agent without losing what mattered, you've proved it
wasn't agent-memory in the first place.

Two scopes, not three:

- **User memory** — what user *U* prefers, decided, told the agent,
  asked it to stop doing. Lives at `users/U/memory/`.
- **Tenant-shared memory** — canonical truths every agent in the
  tenant should converge on (org policies, naming conventions,
  customer-tier definitions, vendor lists, escalation rules).
  Lives at `shared/memory/`.

There is no `agents/<id>/memory/`. Per-persona heuristics belong in
the persona bundle (`agent/src/personas/<role>/`); that's
instructions, not memory. Run-by-run execution traces belong with
the **work**, not with the agent — `tasks/<id>/log.md` for
task-bound wakes, `users/<id>/sessions/<sessionId>.md` for ad-hoc
copilot threads.

Two external signals agree on the surrounding shape:

- **Trove** (`trovefiles.dev`) — "your AI shouldn't start from zero
  every morning"; agents should "work with actual files, not
  embeddings"; each person gets a fully isolated, encrypted space.
- **OpenClaw memory spec** (`joshuathacker.com/openclaw/guides/memory-system-spec`)
  — formalises *what* to write, *when* to write it, *where* to
  file it, *how* to read it back, and how memory *decays* over
  time (daily → durable → archive).

Both reject vector-DB-first thinking. Both treat the filesystem as
the source of truth. The difference is that OpenClaw is
*opinionated* about layout, write triggers, and read order —
exactly what our current memory SKILL is missing.

We already have the storage primitive (Drive, tenant-isolated by
construction). Once task_23 mounts Drive into the workdir as a
filesystem scoped to the wake's human context, **memory is just a
convention layered on top**: an opinionated directory shape, a
SKILL that teaches the agent the conventions, and a hook that
auto-checkpoints after every run so memory accumulates even when
the agent forgets to remember.

The goal: opinionated enough that two agents in the same tenant
converge on identical conventions, lenient enough that an agent
can deviate when the situation warrants, multi-tenant by
construction (tenant privacy is the Drive's job), per-user
respectful, tenant-shared when the truth is canonical.

## 2. Current state — gap analysis

Confirmed by code-walk on 2026-05-12:

- **The memory SKILL teaches almost nothing.** The text loaded into
  every agent's prompt under `## Skills` for memory
  (`packages/@boringos/core/src/modules/memory.ts:17-30`) is three
  bullets: *"use `memory.remember(content, meta?)`; use
  `memory.recall(query)`; don't use memory as a scratchpad."* It
  says nothing about *where* memory lives, *when* to write, *how*
  to find what was written yesterday, what *shape* a memory should
  take, or how memory relates to Drive. Agents currently have no
  way to know that anything they want to remember has a canonical
  home.

- **`MemoryProvider` defaults to `nullMemory`.** When Hebbs (or any
  external memory backend) isn't configured —
  `core/src/boringos.ts:77` — every memory tool returns
  `upstream_unavailable`. Today every BoringOS install without
  Hebbs is amnesiac. That's the bug the user surfaced ("memory is
  not even configured").

- **The drive SKILL teaches Drive's path conventions but never
  mentions memory.** `core/src/modules/drive.ts:35-144` walks the
  agent through `tasks/`, `shared/`, `users/`, `agents/` paths and
  artifact delivery — but a fresh agent reading both SKILLs has
  no way to connect "store this preference somewhere persistent"
  with "Drive's `users/<owner>/` prefix exists." The two siblings
  don't know about each other.

- **No auto-checkpoint.** Agents only remember things when they
  remember to remember. After every run, the engine auto-posts
  the result as a comment (`agent/src/engine.ts` finalisation
  path), but nothing accrues to durable memory. A run that ends
  with "I learned X about user Y" leaves no durable trace if the
  agent didn't explicitly call `memory.remember`.

- **No per-user preferences file.** Even when the user types
  *"don't add co-authors to commits"* in a copilot session, the
  agent has no canonical place to write that down where it'll be
  read on the next wake. Claude Code's own auto-memory system
  (`~/.claude/projects/<...>/memory/MEMORY.md` + one file per
  preference) is a proven pattern at scale; we don't have an
  equivalent.

## 3. The plan — 4 phases

### M1 — The layout

Adopt a *deliberately small* directory shape, drawn from OpenClaw
but cut to what actually earns its keep, at two scopes:

```
users/<userId>/
  preferences.md          — short, hand-edited, agent-readable (the
                            "rules of engagement" with this user)
  memory/
    MEMORY.md             — index + active state for this user
    decisions/            — standing rules this user has set
    domains/              — facts about this user's world
    archive/

shared/
  memory/
    MEMORY.md             — tenant-wide canonical truth
    decisions/            — org policies, naming conventions
    domains/<entity>.md   — company / customer / vendor truth
                            (multi-agent contributors)
    archive/
```

Same four directories at each scope, mirrored deliberately so the
SKILL can teach one shape and apply it twice. Reject OpenClaw's
extra folders (`00-home`, `10-maps`, `15-specs`, `40-research`,
`50-operations`, `70-weekly`) for the initial cut. Don't ship
empty folders; let them grow into the layout as the corpus
warrants.

**Execution trace lives with the work**, not under `memory/`:

```
tasks/<taskId>/log.md                          — task-bound runs
users/<userId>/sessions/<sessionId>.md         — copilot threads
```

A run's chronological trace is appended to one or the other,
depending on what triggered the wake (task vs session). This is
not "agent memory" — it's audit/history of a unit of work, and it
naturally lives with that unit.

### M2 — Five memory classes, with explicit write triggers

OpenClaw's five-class taxonomy maps onto our two scopes by
*scope of the fact*, not by *who learned it*:

| Class | Lives at | When to write |
|---|---|---|
| Durable Fact (user-scope) | `users/<owner>/memory/decisions/<topic>.md`, `users/<owner>/memory/domains/<entity>.md`, top of `users/<owner>/memory/MEMORY.md` | The user established a standing rule, or the agent confirmed a stable fact about the user's world |
| Durable Fact (tenant-scope) | `shared/memory/decisions/<topic>.md`, `shared/memory/domains/<entity>.md`, top of `shared/memory/MEMORY.md` | Canonical org truth, or a fact about a customer/vendor that every agent should converge on |
| Operational State | Active-state section of the relevant `MEMORY.md` | Current blockers, watch items, counters, in-flight approvals |
| Daily Log | `tasks/<id>/log.md` *or* `users/<owner>/sessions/<sessionId>.md` (append-only) | Every run finalisation (auto-checkpoint, M3); ad-hoc by the agent when it observes something worth tomorrow's run |
| Archive | `archive/` under whichever scope the original entry lived | When `MEMORY.md` grows past prompt-useful size, agent promotes stale entries here on next checkpoint |

The seven OpenClaw write triggers translate to BoringOS hooks
(some require the engine to fire them, some are agent-initiated):

1. **Task completion** — engine hook on `agent.run.finished` with
   `success` outcome → log append (M3).
2. **Run failure** — engine hook on `agent.run.failed` → log
   append with the failure mode (M3).
3. **Escalation / approval surfaced** — engine hook when a task
   transitions to a state that needs human input → log append.
4. **Compaction or memory flush** — agent-initiated when the run
   approaches its context budget. SKILL teaches the agent to dump
   in-context observations to the log before compacting.
5. **Before session end** — engine hook on run finalisation
   (universal, regardless of outcome) → see M3.
6. **Owner directive creating a standing rule** — agent-initiated
   when the user types something like *"always do X"* / *"never
   do Y"*. SKILL teaches: write to
   `users/<owner>/memory/decisions/<topic>.md` AND a one-line
   pointer in `users/<owner>/memory/MEMORY.md`. If the rule is
   org-level rather than user-level, route to
   `shared/memory/decisions/` and `shared/memory/MEMORY.md`
   instead — SKILL teaches the routing call.
7. **Fallback / model-routing change** — engine hook on runtime
   fallback (claude → gemini etc.) → log entry, since prior
   model's reasoning shape may differ from current.

The SKILL teaches what *the agent* must do (triggers 4, 6) and
acknowledges what the *framework* does automatically (triggers
1, 2, 3, 5, 7).

### M3 — Auto-checkpoint hook

A single subscriber, mounted at engine boot, listening to
`agent.run.finished` and `agent.run.failed`. On fire:

1. Resolve the wake's destination via the same wake-context
   resolver task_23 introduces: task-bound → `tasks/<id>/log.md`;
   copilot session → `users/<owner>/sessions/<sessionId>.md`.
2. Open or create the log file (today's date in the tenant's
   configured TZ; new files get a header line).
3. Append a structured entry: timestamp, run id, outcome, the
   run's result text (already captured for the auto-comment), and
   any `metadata.memoryNote` set by the agent during the run.
4. **Do not** promote to `MEMORY.md` automatically — promotion is
   the agent's call, made in a future run that consults the log
   and decides what's worth durable storage. This avoids
   polluting `MEMORY.md` with noise.

This is one subscriber, maybe 60 lines. It guarantees that even
an agent that never calls `memory.remember` accrues a
chronological trail. Tomorrow's run reads logs on wake (M4 read
order) and can promote selectively.

The OpenClaw write order — *log first, then promote* — is
preserved: the framework owns the log append (cannot be skipped),
the agent owns the promotion (intentional, deliberate, called
out by SKILL).

### M4 — The SKILL rewrite

Rewrite `core/src/modules/memory.ts` skill markdown
(`memory.ts:17-30` today). Concrete additions:

- **Where memory lives** (assuming task_23 has shipped the mount):
  - User-scope: `./drive/users/<owner>/memory/` (read+write — the
    agent is acting for this user).
  - User prefs: `./drive/users/<owner>/preferences.md` (read-mostly
    — hand-edited by the user but writeable when the user
    explicitly says *"add this to my prefs"*).
  - Tenant-shared: `./drive/shared/memory/` (read+write).
  - Execution log for this run: `./drive/tasks/<active>/log.md`
    *or* `./drive/users/<owner>/sessions/<sessionId>.md`
    (read+write).
- **Read order on wake**, ordered for signal-density:
  1. `./drive/users/<owner>/preferences.md`
  2. `./drive/users/<owner>/memory/MEMORY.md`
  3. `./drive/shared/memory/MEMORY.md`
  4. The current work's log (`tasks/<id>/log.md` or
     `users/<owner>/sessions/<id>.md`) — at least the most recent
     N entries
  5. Targeted `grep` into `decisions/` / `domains/` (both scopes)
     when the task references an entity or topic.
- **Write conventions.** One canonical home per fact. Use the
  4-directory shape. `MEMORY.md` stays prompt-useful — pointers,
  not warehouses.
- **Anti-duplication.** Same operational fact, one home, never
  two. `MEMORY.md` doesn't repeat what's in `decisions/`; logs
  don't restate durable truth.
- **Routing call: user vs shared.** The agent decides by asking:
  *"is this fact only true for this user, or for everyone in the
  tenant?"* User preferences → user. Vendor's payment terms →
  shared. Customer-account contact name → shared. Vague
  observation → log (don't promote yet).
- **Tool fallback.** `memory.remember / recall / forget` tools
  still exist for callers that prefer an API. Internally they
  read+write the same files. Agents are encouraged to use the
  filesystem directly (faster, more transparent, composes with
  Grep / Bash / awk).

The SKILL ships as `core/src/modules/memory/SKILL.md` (move the
inline string out of memory.ts — it's grown past inline-comment
size). Mirror the depth of `core/src/modules/drive.ts`'s skill,
which already lives at length.

### Beyond this task (not in scope)

- Weekly synthesis compactor agent. Earned when daily logs
  consistently exceed a threshold.
- Embedding-based recall as a *complement* to grep — only when
  corpus volume + agent latency budget actually demands it.
- Cross-tenant memory federation. Explicitly out.
- Per-team memory (between user and tenant-shared). Could earn
  its way in later; not load-bearing today.

## 4. Risks

- **The agent doesn't follow the SKILL.** Skills are advisory.
  Mitigation: M3 auto-checkpoint is non-optional and lives in
  the framework, so logs accumulate regardless of agent
  discipline. Promotion is the part that depends on agent
  cooperation, and bad promotion just means `MEMORY.md` stays
  sparse — not catastrophic.

- **The agent writes user-scope facts into shared, or vice
  versa.** Mitigation: the SKILL's routing rule is explicit. As
  a backstop, the auto-checkpoint hook writes logs to the
  unambiguous correct location (task or session) and never to a
  `MEMORY.md` — only the agent's deliberate promotion call
  decides scope.

- **`MEMORY.md` becomes a warehouse anyway.** OpenClaw's own
  warning. Mitigation: SKILL repeats "pointers, not warehouses"
  and teaches archive promotion. Optional follow-up: a length
  check that nudges the agent to archive when `MEMORY.md`
  exceeds N kB.

- **Two agents in the same tenant develop divergent shared
  memory conventions.** Mitigation: the shared SKILL is the
  same across agents (one file). Anti-duplication rule pushes
  toward convergence. If we see drift in practice, a "memory
  curator" routine can normalise.

- **User edits `preferences.md` and the agent doesn't notice.**
  Mitigation: the file is read every wake (M4 read order step
  1). No caching layer between Drive and the agent for that
  path.

- **A wake with no human owner has nowhere to store user-scope
  observations.** Correct behaviour: it should not be making
  user-scope observations. Such wakes (routines, crons) operate
  on tenant-shared truth, and writes route to `shared/`. The
  M4 SKILL spells this out so the agent doesn't get confused.

- **Tenant deletion.** Drive's tenant-prefix model means memory
  is removed when the tenant is removed. Nothing extra to do;
  just confirm in the tenant-teardown path.

- **Hebbs (or another semantic-memory backend) is later added.**
  No conflict. The Drive-backed memory is the floor; an external
  backend wraps the same `MemoryProvider` interface and can
  optionally *also* index Drive contents for semantic recall.
  Drive remains source of truth.

## 5. Touch list

- `packages/@boringos/core/src/modules/memory.ts` — replace
  inline skill markdown with a load of `memory/SKILL.md`. Tools
  (`remember` / `recall` / `forget`) keep their schemas; their
  implementations switch to read/write under `users/<owner>/memory/`
  or `shared/memory/` via the Drive backend, routed by the
  caller's wake-context.
- `packages/@boringos/core/src/modules/memory/SKILL.md` — NEW.
  The opinionated layout, read order, write triggers, routing
  rule (user vs shared), anti-duplication rule. Mirrors the
  depth of `modules/drive.ts`'s skill.
- `packages/@boringos/memory/src/drive.ts` — NEW.
  `createDriveMemory(deps: { drive, tenantId })` returning a
  `MemoryProvider`. Internal impl: `remember()` writes a file
  (routes by `meta.scope` — `user:<id>` or `tenant`); `recall()`
  greps + reads across the in-scope `memory/` trees; `forget()`
  removes a file by id. Used as the new default when no external
  provider is configured (replaces `nullMemory` at
  `boringos.ts:77`).
- `packages/@boringos/agent/src/memory-checkpoint.ts` — NEW. The
  subscriber for `agent.run.finished` / `.failed`. Resolves
  destination via wake-context and appends to the right log
  file.
- `packages/@boringos/agent/src/engine.ts` — wire
  `memory-checkpoint` at boot.
- `packages/@boringos/core/src/auth/` — on user signup, scaffold
  `users/<id>/preferences.md` with a starter template (H2
  sections per known preference category, all empty). Same
  touchpoint as task_23 F2.

## 6. Done when

A new tenant is created, the user types in the copilot session
*"never add co-authors to commits"*, and the following observable
chain happens:

1. The agent's run writes
   `users/<user>/memory/decisions/commit-authoring.md` with the
   rule and a one-line pointer in
   `users/<user>/memory/MEMORY.md`.
2. The auto-checkpoint hook appends the run's result to
   `users/<user>/sessions/<sessionId>.md`.
3. The next day, in a fresh wake by the same user,
   `grep -r "co-author" ./drive/users/<user>/memory/` returns
   the decision file and the pointer from `MEMORY.md`.
4. The agent's next run that touches a git commit reads the
   decision and does not add a `Co-Authored-By` line.
5. The user edits `users/<user>/preferences.md` to add *"prefer
   terse responses"*. The next wake by that user, the agent's
   responses become terse — without any user re-prompt.
6. A *different* user in the same tenant wakes the agent on
   their own task. `ls drive/users/` from that wake shows only
   *their* dir; the first user's `decisions/commit-authoring.md`
   is unreachable. Cross-user privacy held.
7. A second agent in the same tenant, operating on a shared
   org-level task (no specific user owner), can read
   `./drive/shared/memory/MEMORY.md` and apply tenant-canonical
   rules — but reads no `users/*` at all.
8. Deleting Hebbs config (or never having it) does not break
   memory — the system stays useful on Drive alone.

## 7. Status log

- 2026-05-12 — task drafted from memory evaluation discussion.
  Sources: Trove (filesystem-not-embeddings thesis), OpenClaw
  memory spec (5-class taxonomy + write triggers + read order),
  Claude Code's own auto-memory pattern at
  `~/.claude/projects/<...>/memory/`. Cross-references task_23
  for the filesystem-mount prerequisite.
- 2026-05-12 — revised after design call: dropped agent-private
  memory entirely. Memory is user + tenant only. Execution
  trace moved from agent-private daily/ to per-work
  task-log/session-log. Tenant privacy stays as the Drive's
  responsibility — no rework needed at that layer.
