# Memory

You have **persistent, file-based memory** at `./drive/` in your
workdir. Everything you write here survives the run. Read it on every
wake. Save deliberately, in small useful pieces, at the right scope.

## How you read and write memory

**Use the filesystem.** `Read`, `Write`, `Edit`, `Grep`, `Glob`, and
`Bash` (`cat`, `find`, `rg`, `ls`) all work on `./drive/` natively.
This is the only path. Do not call `memory.remember` / `memory.recall`
/ `memory.forget` — those tools exist for code that isn't running
inside an agent (the shell UI, scripts, webhooks). If you reach for
them, stop and use `Write` / `Grep` instead. Same on-disk endpoint,
no HTTP round-trip, composes with shell pipelines.

## The cardinal rule

**When the user says "save", "remember", "note", "from now on", "always",
or any phrase that implies persistence — you MUST write a file before
responding.** Saying "Saved" or "I'll remember" without an actual
filesystem write is a lie. Verify with `ls` after writing if you're
unsure.

## Where memory lives

Two scopes only — there is no agent-private memory. Memory belongs to
the **human** or to the **org**, never to "this agent." You are the
consumer; the user/tenant is the holder.

```
./drive/users/<owner>/memory/
  MEMORY.md          ← index + active state (you maintain this)
  decisions/<topic>.md  ← standing rules this user has set
  domains/<entity>.md   ← stable facts about this user's world
  notes/             ← quick captures when structure isn't ready yet
  archive/           ← rolled-out historical detail

./drive/shared/memory/
  MEMORY.md          ← tenant-wide canonical truth
  decisions/<topic>.md  ← org policies, naming conventions
  domains/<entity>.md   ← customer/vendor/company facts
  notes/             ← tenant-scope quick captures
  archive/
```

There's also the user's hand-edited rules of engagement at
`./drive/users/<owner>/preferences.md` — **always read this first**.
The human telling you their preferences directly.

## Read order on every wake

Run these reads at the start of every wake, in order:

```
cat ./drive/users/<owner>/preferences.md                   # if owner exists
cat ./drive/users/<owner>/memory/MEMORY.md                 # if owner exists
cat ./drive/shared/memory/MEMORY.md
# Then the current work's log:
cat ./drive/tasks/<active>/log.md                          # if task-bound
# Or for copilot sessions:
cat ./drive/users/<owner>/sessions/<sessionId>.md          # if session-bound
# Then targeted searches when a topic surfaces:
grep -ri "<topic>" ./drive/users/<owner>/memory/
grep -ri "<topic>" ./drive/shared/memory/
```

Skip the user-scope reads when there's no `<owner>` (routine / cron
/ webhook wakes — you're acting on tenant scope only).

## When to write

The framework auto-checkpoints every run's outcome into the work's
log file. **You don't have to remember to log.** What you do have to
remember to do:

1. **Persist owner directives establishing a standing rule.** Write
   `decisions/<topic>.md` plus a one-line pointer in `MEMORY.md`.
2. **Persist confirmed facts about the user's or tenant's world.**
   Write `domains/<entity>.md` plus a one-line pointer in `MEMORY.md`.
3. **Dump in-flight observations before compacting context.** Append
   to `notes/<iso-timestamp>.md` so they survive even if you don't
   promote them.

## How to write — the format

**`decisions/<topic>.md`** — one rule per file. Filename is the topic
in kebab-case (`commit-authoring.md`, `communication-style.md`).
Body is the rule + the why + the source if relevant. Short.

```markdown
# Commit authoring

Never add `Co-Authored-By` lines to commit messages.

**Why:** Parag told me 2026-05-12 in copilot. He prefers credit
clean, no AI attribution.

**How to apply:** Strip `Co-Authored-By` from any commit template
before using it.
```

**`domains/<entity>.md`** — one entity per file. Filename is the
entity slug (`talker-network.md`, `acme.md`). Body is durable facts.

```markdown
# Talker.Network

- Tier: Enterprise
- Contract: net-30
- Primary contact: parag@talker.network
- Source: confirmed by Parag 2026-05-12
```

**`MEMORY.md`** — the index. One line per pointer. **Update it every
time you write a `decisions/` or `domains/` file.** Pointers, not
warehouses.

```markdown
## Standing rules
- [Commit authoring](decisions/commit-authoring.md) — no co-authors
- [Communication style](decisions/communication-style.md) — terse, no preamble

## Known entities
- [Talker.Network](domains/talker-network.md) — Enterprise customer, net-30
```

## Routing call: user vs tenant

Ask: *"is this fact only true for this user, or for everyone in the
tenant?"*

- The user said "I prefer terse responses" → **user**
  (`./drive/users/<owner>/memory/decisions/communication-style.md`)
- The user mentioned "Acme's payment terms are net-30" → **tenant**
  (`./drive/shared/memory/domains/acme.md`) — every agent working
  with Acme should know this.
- The user described a customer contact's role → **tenant**
- The user described their own workflow preference → **user**
- Vague observation you might want later → **notes/** in either
  scope (don't promote yet).

When in doubt: user-scope first. Promotion to tenant is intentional;
demotion the other way is hard.

## Anti-patterns

- **Don't lie about saving.** "Saved" without a `Write` call is
  forbidden. Persist first; *then* tell the user it's saved.
- **Don't dump in-run thinking here.** Memory is for cross-run
  continuity. In-run thinking belongs in comments on the task.
- **Don't skip the `MEMORY.md` pointer.** A `decisions/X.md` with
  no entry in `MEMORY.md` is invisible to future grep-based recall.
  Always update both.
- **Don't write to other users' dirs.** The mount only exposes
  the current wake-owner's `users/<id>/` — sibling users aren't
  reachable.
- **Don't restate facts in multiple places.** One canonical home per
  fact. `MEMORY.md` carries pointers; the detail lives in the
  pointer's target.
- **Don't archive prematurely.** If a rule is still in force, leave
  it in `decisions/`. Move to `archive/` only when it's stale,
  superseded, or historical.

## Why the filesystem (not a memory API)

You're running with `--dangerously-skip-permissions`. `Read` /
`Grep` / `Glob` / `Bash` operate on `./drive/` at filesystem speed
— microseconds per call, no HTTP round-trip, composes with shell
pipelines. The `memory.*` tools that exist in the framework's tool
catalog go through HTTP for callers who don't have a filesystem
mount (the shell UI, scripts, webhooks). For you, the filesystem is
always faster, more transparent, and more composable. Use it.
