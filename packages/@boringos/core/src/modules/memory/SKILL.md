# Memory

Cross-run cognitive memory. Everything you write here is **searchable
forever** — so write deliberately, in small useful pieces, and at the
right scope.

## Where memory lives

Two scopes only — there is no agent-private memory. Memory belongs to
the **human** or to the **org**, never to "this agent." You're the
consumer; the user/tenant is the holder.

```
./drive/users/<owner>/memory/
  MEMORY.md          ← index + active state (you maintain it)
  decisions/         ← standing rules this user has set
  domains/           ← stable facts about this user's world
  notes/             ← memory.remember() lands here
  archive/           ← rolled-out historical detail

./drive/shared/memory/
  MEMORY.md          ← tenant-wide canonical truth
  decisions/         ← org policies, naming conventions
  domains/<entity>.md  ← customer/vendor/company facts
  notes/             ← memory.remember(scope: "tenant") lands here
  archive/
```

There's also the user's hand-edited rules of engagement at
`./drive/users/<owner>/preferences.md`. **Always read it first** —
it's the human telling you their preferences directly.

## Read order on every wake

1. **`./drive/users/<owner>/preferences.md`** — what the human wants
   from you, in their own words. Read this even if you've worked
   with them before; they may have updated it.
2. **`./drive/users/<owner>/memory/MEMORY.md`** — your own running
   index of what you know about this user.
3. **`./drive/shared/memory/MEMORY.md`** — tenant canonical truth.
4. **The current work's log** — either
   `./drive/tasks/<active>/log.md` (task-bound) or
   `./drive/users/<owner>/sessions/<sessionId>.md` (copilot
   threads). At minimum the last 10 entries; more if the work has
   history.
5. **Targeted grep** when a topic surfaces — `grep -ri "<topic>"
   ./drive/users/<owner>/memory/decisions/` and the equivalent in
   `domains/`.

Skip steps 1–2 if there's no `<owner>` (routine / cron / webhook
wakes). You're operating on tenant scope only.

## When to write

Write at these moments — most are framework-triggered, two are on you:

| Trigger | Who fires | Where |
|---|---|---|
| Task completion | Framework | session/task log (auto-checkpoint) |
| Run failure | Framework | session/task log |
| Escalation / approval surfaced | Framework | session/task log |
| Compaction approaching | **You** | log first, before you lose context |
| Owner directive establishing a standing rule | **You** | `decisions/<topic>.md` + pointer in `MEMORY.md` |
| Model/runtime fallback | Framework | session/task log |
| Session end | Framework | session/task log (auto-checkpoint) |

You **never** have to remember to log. The framework checkpoints
every run's result to the right log. You **do** have to remember to
promote — when the user says "always do X", that's a
`decisions/<topic>.md` you write deliberately.

## How to write

**One canonical home per fact.** No duplication. `MEMORY.md` carries
one-line pointers; the full detail lives in the sibling file the
pointer points to. Don't restate durable truth in logs; don't restate
log entries in `MEMORY.md`.

**`MEMORY.md` stays prompt-useful.** Pointers, not warehouses. If you
find yourself writing a paragraph, that paragraph belongs in
`decisions/` or `domains/` with a one-line pointer in `MEMORY.md`.

**File names are descriptive.** `decisions/commit-authoring.md`, not
`decisions/2026-05-12.md`. The filename is part of how you'll find it
later.

## Routing call: user vs tenant

Ask: *"is this fact only true for this user, or for everyone in the
tenant?"*

- The user said "I prefer terse responses" → **user**
  (`users/<owner>/memory/decisions/communication-style.md`)
- The user mentioned "Acme's payment terms are net-30" → **tenant**
  (`shared/memory/domains/acme.md`) — every agent dealing with Acme
  should know this.
- The user described a customer contact's role → **tenant**
- The user described their own workflow preference → **user**
- Vague observation you might want later → **notes/** in either
  scope (don't promote yet).

When in doubt: user-scope first. Promotion to tenant is intentional;
demotion the other way is hard.

## Tool API vs filesystem

Two paths reach the same files:

- **Filesystem (preferred for structured writes)** — `Write`, `Read`,
  `Grep`, `Glob`, `Bash` work natively on `./drive/.../memory/`.
  Faster, composes with shell pipelines, no JSON round-trip. Use
  this for promoting facts to `decisions/`, `domains/`, or
  `MEMORY.md`.
- **`memory.remember` / `memory.recall` / `memory.forget` tools** —
  for quick scratch saves when you don't have structure yet. Tool
  writes land in `notes/`; tool reads grep the whole memory tree.

Both paths see each other's writes. Pick whichever fits the moment.

## Anti-patterns

- **Don't dump in-run thinking here.** Memory is for cross-run
  continuity. In-run thinking belongs in comments on the task.
- **Don't write to other users' dirs.** You can only reach the
  current wake-owner's `users/<id>/` — sibling users are invisible.
- **Don't restate.** Anti-duplication is the rule.
- **Don't archive prematurely.** If a rule is still in force,
  it belongs in `decisions/`, not `archive/`. Move only when it's
  stale, superseded, or historical.
- **Don't add a `MEMORY.md` entry without the detail file behind
  it** (unless the entry IS the detail and it's one line). A
  pointer that points at nothing creates a search dead-end later.
