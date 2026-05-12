# Task 23 — Drive as the agent's actual filesystem

## Status

NOT STARTED. Prerequisite for task_24 (memory system).

## 1. The principle

We built ~90% of Trove without realising it. The Drive package already
gives every tenant a fully isolated namespace, with per-user /
per-task / per-project / shared sub-namespaces and ACLs in
`drive-acl.ts`. Tenant-level privacy is solid and stays untouched.

What we forgot is that the agent doesn't actually have a filesystem
in its workdir. The Drive lives behind HTTP tools. To read its own
notes the agent must `drive.read("users/<owner>/...")` — a tool call
per file, no shell-composable pipelines, no `grep`, no `glob`,
no `cat | jq`. The CLI runtime
(`packages/@boringos/runtime/src/runtimes/claude.ts`) spawns claude
with `--dangerously-skip-permissions`, so the agent *could* freely
use `Read` / `Bash` / `Grep` / `Glob` on a real folder — but the
folder it's pointed at is a temp dir, not the agent's data.

This task fixes the foundation: **when the agent wakes, the slice of
Drive that the wake's human context can see is mounted into the
workdir under `./drive/` as a tree of symlinks**. Reads and writes
become native filesystem operations. Search becomes free — the
existing Grep / Glob / Bash tools work without us shipping a single
new RPC.

The mount is driven by **the wake's human context**, not by the
agent's identity:

- For a wake triggered by user *U*: the agent gets read+write on
  `users/U/`, `shared/`, and the active `tasks/<id>/`.
- For a wake with no human owner (routine, cron, webhook): the
  mount is just `shared/` plus the active `tasks/<id>/`. No
  `users/*` at all.
- A wake for user *U* never exposes `users/V/` for any other user.

This sidesteps any rework on tenant privacy or per-agent ACL
nuance: agents acting on behalf of user *U* are effectively *U*'s
delegate within the tenant, with the obvious caveat that they
cannot reach other users' private spaces.

This is the load-bearing change. Task 24 (memory) is impossible
until this is in place, because the memory SKILL needs to be able
to say "grep `./drive/users/<owner>/memory/decisions/`" and have
that actually work without ten tool calls.

## 2. Current state — gap analysis

Confirmed by code-walk on 2026-05-12:

- **Drive scoping exists and is correct.**
  `packages/@boringos/drive/src/manager.ts:56` prefixes every write
  with `${tenantId}/`. Within a tenant,
  `packages/@boringos/core/src/modules/drive-acl.ts` defines
  sub-namespaces with ACLs (`shared/*`, `tasks/<id>/*`,
  `projects/<id>/*`, `agents/<id>/*`, `users/<id>/*`). The tenant
  envelope is intact; nothing about cross-tenant privacy needs
  rework.

- **Workdir is detached from Drive.** `runtimes/claude.ts:24` sets
  `cwd = ctx.workspaceCwd ?? process.cwd()`, and the engine
  (`packages/@boringos/agent/src/engine.ts`, around lines 299–313
  in the execute call) never populates `workspaceCwd`. The
  runtime context has the field; nothing fills it.

- **Skills are already symlinked, Drive is not.**
  `agent/src/skills.ts:82-114` shows `injectSkills()` linking
  curated skill bundles into `{workDir}/.claude/skills/<key>/`.
  The same symlink machinery, pointed at Drive prefixes, would
  solve this task in a few hundred lines.

- **Drive tools are CRUD only.** `core/src/modules/drive.ts:478-496`
  exposes `read / write / write_binary / list / delete / exists /
  move`. No `search` / `grep` / `find` / `query`. Today the agent
  must `list()` then `read()` each result to keyword-match.

- **`users/*` is currently fully off-limits to agents.**
  `drive-acl.ts:239` blocks any agent access. That's the right
  default for "user U's draft email is not random agent X's
  business", but it's wrong for the *wake-owner's* user dir, which
  is exactly the agent's workspace for the current run.

## 3. The plan — 3 phases

### F1 — Workdir mount (the core change)

On every agent wake, before the CLI subprocess spawns, materialise
the slice of Drive the wake's human context can see as a symlink
tree at `<workDir>/drive/`. Concretely:

- `<workDir>/drive/shared/` → symlink to the tenant's shared lane
  (read+write). Always present.
- `<workDir>/drive/tasks/<activeTaskId>/` → symlink to the active
  task's deliverables (read+write). Present when the wake is
  task-bound.
- `<workDir>/drive/users/<ownerId>/` → symlink to the wake-owner's
  user-private space (read+write). Present only when the wake has
  a resolvable human owner. Multi-user tenants: only the
  *current* owner is mounted, never sibling users.
- `<workDir>/drive/projects/<id>/` → projects the active task is
  attached to (read+write per current ACL). Present when applicable.

The mount is **per-run**: re-built each wake from the wake's
identity + the current task, then torn down on run finalisation
(same lifecycle as the workspace itself). No persistent mount that
can drift out of sync with ACL changes.

Routine / cron / webhook wakes with no owner get a smaller mount —
`shared/` plus the active task only. They cannot read or write any
user's private space. This is the correct default and falls out of
the "human context drives the mount" rule for free.

Wire site: `agent/src/workspace.ts` already provisions the workdir
and runs `injectSkills()` (per `agent/src/skills.ts`). Add an
`injectDrive()` step alongside it, called from the same caller.
The runtime ctx then carries `workspaceCwd = workDir`, so
`runtimes/claude.ts:24` resolves to the mounted workdir instead of
`process.cwd()`.

### F2 — Resolving the wake's human context

The mount needs to know *who the wake is for*. The engine already
threads this through the wakeup record / task row, but the runtime
context doesn't surface it as a single value today. Concretely:

- Task-bound wake → the task's `created_by` user, or the task's
  current assignee if explicitly delegated.
- Copilot session wake → the user-id who owns the session.
- Routine / cron / webhook wake → null (no human owner).
- User-initiated tool dispatch → the calling user's id from the
  auth context.

Centralise this into a single resolver
(`agent/src/wake-context.ts`, new), called once per wake. The
resolver's output feeds both the mount in F1 and the memory
read-order in task 24. Without a single canonical resolver the
two will drift.

### F3 — Optional `drive.search` tool

For callers that legitimately need server-side search (UI
surfaces, tools dispatched from outside an agent run, third-party
connectors), add `drive.search(query, prefix?, maxResults?)` as a
thin grep over the Drive backend. ACL'd identically to
`drive.list` — caller can only search prefixes they have read
access to.

This is **optional, not load-bearing**: in-agent search is solved
by F1 (the agent's built-in Grep / Glob just work on the mount).
F3 exists for non-agent callers. Cut from this task if it slips.

## 4. Risks

- **Symlink semantics on macOS/Linux/Windows.** The framework
  targets Node ≥ 22 on Linux + macOS in production; macOS dev is
  the daily-driver path. Windows is not a target (no Windows
  symlink dance). Node `fs.symlinkSync` with type `"dir"` is what
  `agent/src/skills.ts:82-114` already uses successfully — same
  pattern.

- **A user's private space is leaked to an agent that wasn't
  invoked by them.** Mitigation: the wake-context resolver (F2)
  is the single source of truth. If a wake has no owner, no
  `users/*` is mounted, full stop. Test that routine-fired wakes
  cannot see any `users/*` directory.

- **Agent escalates from one user's context into another's during
  the same run.** Cannot happen — the mount is materialised once
  per run from the wake's owner. Mid-run user switching is not a
  thing in BoringOS today. If we add cross-user copilot in the
  future, the mount can be rebuilt on session-owner change or the
  agent can be re-spawned.

- **ACL drift between filesystem mount and `drive-acl.ts`.** The
  per-run rebuild eliminates this — every wake reads current ACL
  state and re-materialises the mount. Don't cache.

- **Symlink performance with very wide trees.** Symlinks themselves
  cost nothing; agent traversal does. Mirror `agent/src/skills.ts`:
  link directories, not individual files.

- **Race between concurrent runs of the same agent.** The wakeup
  coalescer (`createWakeup` in `agent/src/engine.ts`) already
  prevents simultaneous runs of the same agent. Within that
  guarantee, per-run workdirs cannot collide.

- **Storage backend that isn't a real FS.** `StorageBackend` is
  pluggable; production might run S3-backed. Symlinks need a
  filesystem. Document that F1 requires the local-FS backend
  (which is the default). S3 backend support can FUSE-mount or
  fall back to tool-only access — out of scope for this task.

## 5. Touch list

- `packages/@boringos/agent/src/wake-context.ts` — NEW. Resolves
  the wake's human owner (user-id or null) from the wakeup /
  task / session / auth chain. Single source of truth for the
  mount and for memory.
- `packages/@boringos/agent/src/workspace.ts` — add `injectDrive()`
  callsite next to existing `injectSkills()`, fed by
  wake-context output.
- `packages/@boringos/agent/src/drive-mount.ts` — NEW. The
  symlink-tree builder. Mirrors `agent/src/skills.ts` in shape
  and size.
- `packages/@boringos/agent/src/engine.ts` — pass
  `workspaceCwd = workDir` when constructing runtime ctx (the
  field already exists at `runtime/src/types.ts:52`); call
  `wake-context` once per wake.
- `packages/@boringos/core/src/modules/drive-acl.ts` — relax the
  `users/*` block for the current wake-owner only. The ACL
  enforcement layer learns about "active wake-owner" the same
  way it learns about active task / project context today.
- `packages/@boringos/core/src/modules/drive.ts` — (F3, optional)
  add `searchTool`. Thin wrapper around `StorageBackend.list` +
  content scan.
- `packages/@boringos/core/src/modules/drive/SKILL.md` (or
  wherever the drive skill is loaded from) — teach the new
  convention: *"your data lives under `./drive/` in the workdir;
  use Grep/Glob/Read directly. Write goes through the API for
  audit + SSE."* Reads short-circuit to filesystem; writes still
  go through tools so the audit trail and realtime events fire.

## 6. Done when

- An agent wakes for a task owned by user *U*, runs `ls drive/`
  in its workdir, and sees `shared/`, `tasks/<id>/`, and
  `users/U/`. Nothing else.
- The same agent later wakes for a task owned by user *V*, and
  sees `users/V/` instead of `users/U/`.
- A routine-fired wake runs `ls drive/` and sees `shared/` plus
  the active task, but **no `users/`** directory.
- The agent runs `grep -r "follow-up" drive/users/U/` and gets
  hits without any tool call going through the host.
- The agent attempts a stray `cat drive/users/V/...` during a
  *U*-owned wake; the file does not exist in the mount and the
  attempt fails with ENOENT.
- `drive-acl.ts` tests still pass — tenant-level and
  non-wake-owner ACL semantics did not regress.
- (If F3 shipped) `drive.search("query", "shared/")` returns hits
  scoped to the requested prefix.

## 7. Status log

- 2026-05-12 — task drafted from drive + memory evaluation
  discussion (Trove + OpenClaw learnings, see task_24).
- 2026-05-12 — revised after design call: mount is scoped by the
  wake's human context (user-id) rather than agent-identity.
  Eliminates the agent-private slot, per-agent ACL nuance in the
  mount, and "sibling agents read-only" view. Tenant-level
  privacy untouched.
