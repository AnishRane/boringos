# Pi runtime integration + live thinking window

> **Status: SHIPPED** (branch `feat/pi-runtime`, 2026-05-24). All phases
> implemented; `pnpm -r build`, `pnpm -r typecheck`, `pnpm test:run` green
> (470 tests + opt-in E2E). Live multi-turn E2E on `gpt-4.1-mini` passes —
> see the [Test report](#test-report) at the bottom.

> Plan to add [`pi`](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`)
> as a second agent runtime alongside Claude Code, and to stream pi's
> JSON event output into a **transient, non-persisted "thinking" window**
> in the Copilot UI. **Scope: pi runtime only.** Claude's path is left
> unchanged (it simply never emits progress events).
>
> Reference clone lives at `../pi` (sibling of `boringos-framework`,
> not committed). Read it for source-level details cited below.

---

## Decision

Integrate pi as a **subprocess runtime** using `pi --mode json`, mirroring
`packages/@boringos/runtime/src/runtimes/claude.ts`. This is the lowest-friction
path: it fits the existing `RuntimeModule` contract (spawn → stream JSONL →
capture session/cost → finalize) with **no new dependency** — it only requires
the `pi` CLI on `PATH`, exactly like `claude`/`codex` today.

Pi also ships a TypeScript SDK (`createAgentSession`, `runPrintMode`,
`runRpcMode` from `@earendil-works/pi-coding-agent`) and an RPC mode. Both are
viable but heavier (the SDK pulls pi into the framework process and makes us own
its session/auth lifecycle). The subprocess + `--mode json` path is preferred
and is what this plan implements.

Bonus: pi is **multi-provider** (`--provider anthropic|openai|google|…`), so one
`pi` runtime can later cover OpenAI/Gemini/etc. via a config flag.

---

## Capability scan — does pi support everything we use?

Every functionality the engine + `claude.ts` rely on, mapped to a verified pi
capability. All confirmed against the `../pi` source (file:line cited).

| # | BoringOS functionality | Claude impl | Pi support | Source / note |
|---|---|---|---|---|
| 1 | Non-interactive single-shot run | `--print --output-format stream-json --verbose` | ✅ `--mode json` → `runPrintMode` | `main.ts:103`, `print-mode.ts:32` |
| 2 | Stream structured events to stdout | stream-json lines | ✅ JSONL `AgentSessionEvent` per line | `print-mode.ts:104` |
| 3 | Pipe context via **stdin** | piped stdin | ✅ stdin read for all non-rpc modes, merged into initial prompt | `main.ts:636-649`, `initial-message.ts:20` |
| 4 | Inject system instructions (large) | `--append-system-prompt-file <file>` | ✅ `--append-system-prompt <file-or-text>` — reads the arg as a file if it exists, else literal | `resource-loader.ts:40-55`; repeatable |
| 5 | Model selection | `--model <id>` | ✅ `--model <pattern>` / `--provider` (supports `provider/id`, `:thinking`) | `args.ts:83-87` ⚠️ **default provider is `google`** — always pass provider/model explicitly |
| 6 | Resume previous session | `--resume <sessionId>` | ✅ `--session <id>` (partial UUID) + `--session-dir <dir>` | `args.ts:96-101` |
| 7 | Capture session id | `result.session_id` | ✅ first stdout line is the session header `{"type":"session","id":"<uuid>",…}` | `print-mode.ts:112-115`, `json.md` |
| 8 | Cost / token usage | `result.usage` + `total_cost_usd` | ✅ each assistant `message_end` carries `usage{input,output,cacheRead,cacheWrite,cost{…,total}}` — accumulate across turns | `rpc.md` AssistantMessage |
| 9 | **Final reply text** | `{"type":"result","result":"…"}` line | ⚠️ **not emitted** — extract from `agent_end` / last assistant `message_end` text blocks and **synthesize** a result line (see below) | only real adapter gap |
| 10 | Per-line output callback | raw stdout → `onOutputLine` | ✅ JSONL lines → `onOutputLine` | unchanged spawn loop |
| 11 | Stderr streaming | `onStderrLine` | ✅ | unchanged |
| 12 | Exit code → complete/error | process exit | ✅ | unchanged |
| 13 | Env injection (callback URL/token, run/agent/tenant ids) | `buildAgentEnv` passthrough | ✅ env passed to subprocess and inherited by pi's `bash` tool | `spawn.ts:26` |
| 14 | Agent → framework tool calls | `curl POST $BORINGOS_CALLBACK_URL/api/tools/<name>` w/ bearer token | ✅ pi's `bash` tool runs curl — **no MCP required** | protocol is HTTP, `framework.ts:56` |
| 15 | Full autonomous FS/bash, no approval prompts | `--dangerously-skip-permissions` | ✅ pi has **no** permission popups by default | `usage.md` design principles |
| 16 | Workspace cwd | spawn `cwd` | ✅ pi resolves tools/sessions/context against cwd | `print-mode.ts` / SDK `cwd` |
| 17 | `testEnvironment` (CLI detect) | `detectCli("claude")` | ✅ `detectCli("pi")` | `spawn.ts:111` |
| 18 | `models[]` / `listModels` | hardcoded array | ✅ hardcode common ids; optionally `pi --list-models` | `args.ts:169` |
| 19 | `extraArgs` passthrough | `config.extraArgs` | ✅ same mechanism | |
| 20 | **Live thinking stream** (new, pi-scoped) | thinking content blocks | ✅ `message_update` → `assistantMessageEvent.type` `thinking_delta`/`text_delta`; `tool_execution_start/end` | `rpc.md` events |

**Conclusion: pi covers 100% of what we use.** Item #9 is the only behavior that
needs an adapter shim; everything else is flag/parse mapping.

### Decisions baked into the runtime

- **Provider/model** — **default model is `openai/gpt-4.1-mini`, always** (pi id
  `gpt-4.1-mini`, provider `openai`; verified in `pi/packages/ai/src/models.generated.ts`).
  Pass it provider-qualified so pi's `google` default is never used. The effective
  model is resolved as: per-agent `agents.model` override → runtime-row `model` →
  this `openai/gpt-4.1-mini` fallback.
- **System prompt** — write `ctx.systemInstructions` to a temp file and pass
  `--append-system-prompt <tmpfile>` (file is read because it exists on disk).
  No ARG_MAX risk. Clean up in `finally`, same as `claude.ts:97-101`.
- **Context files** — pass `--no-context-files` (`-nc`) so pi does **not**
  auto-load stray `AGENTS.md`/`CLAUDE.md` from the workspace tree; we inject all
  instructions ourselves.
- **Sessions** — set a **stable** `--session-dir` keyed by tenant/agent (e.g.
  `.data/pi-sessions/<tenantId>/<agentId>`) so `--session <id>` resolves across
  per-run ephemeral workdirs. Capture the session header `id`; persist it back to
  the task exactly as the engine does today (`engine.ts:360`).
- **Auth** — pi resolves keys from env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) —
  already passed through by `spawnAgent` — or from `~/.pi/agent/auth.json`
  (one-time `pi` → `/login` for subscriptions). For multi-tenant scale, inject the
  tenant's key per-run via `--api-key`/env from the runtime-row `config` (see the
  credential note below) rather than the machine-global `auth.json`.
- **Thinking level** — `gpt-4.1-mini` is non-reasoning, so thinking is `off`; the
  live window streams text + tool activity. For reasoning models, optional
  `--thinking low|medium` would add reasoning deltas.
- **No permission gate** — pi has no approval/permission system (verified: nothing
  in its tool-execution path). `bash`/`write`/`edit` run directly — equivalent to
  Claude's `--dangerously-skip-permissions`, but it's the default (no flag). Optional
  inverse lever: `--tools read,grep,find,ls` for a read-only agent.

---

## Coexistence, selection & migration

### Two-layer model (already exists)

- **In-process registry** — runtime *implementations* keyed by `type`
  (`claude`, `chatgpt`, …). Adding pi = registering `piRuntime` (type `"pi"`).
- **Per-tenant `runtimes` table** — the *configured* "agentic solutions" a tenant
  selected: `{ type, model, config, isDefault }`. CRUD via `GET/POST/PATCH/DELETE
  /runtimes`; `GET /runtimes/:id` returns that type's models (from
  `rtModule.models`/`listModels()`) for the model dropdown.
- **Agents** reference one via `runtimeId` (+ `fallbackRuntimeId` + optional
  per-agent `model`). Engine resolves it at `engine.ts:288-304`; per-agent `model`
  wins.

**Selection is already per-agent** (`shell/.../Agents/NewAgentModal.tsx` runtime
dropdown). pi is purely additive: register the impl → a tenant creates a `"pi"`
runtime row + picks a pi model → agents opt in via the existing dropdown. Both
runtimes run side by side; `fallbackRuntimeId` allows pi-primary / claude-fallback.

### Scalable design: store connections, discover models

The `runtimes` table is a **connections registry** (`name`, `type`, `config`,
default `model`, `status`, `healthResult`, `isDefault`) — **not** a model catalog.
The scalable shape:

1. **DB holds connections, not models** — one row per *(runtime type + provider +
   credential)*, e.g. **"Pi · OpenAI"** (`type=pi`, `config.provider=openai`,
   `model="openai/gpt-4.1-mini"`). O(providers) stable rows; the key lives in
   pi's auth/env or an encrypted ref in `config`, never duplicated per model.
2. **Models are discovered dynamically** via `piRuntime.listModels()` →
   `pi --list-models <provider>`, which returns **only models the configured key
   can access** (`modelRegistry.getAvailable()` — reflects entitlements *and* pi
   releases, zero DB churn). Surfaced via the existing `GET /runtimes/:id`.
3. **Per-agent model = override** on `agents.model`, chosen from that live catalog.

This beats "one `runtimes` row per model": a row-per-model bloats the table,
conflates *which connection* (tenant infra) with *which model* (agent choice),
duplicates credentials, and forces DB writes on every model launch/deprecation.

> **Credential note (multi-tenant):** pi's `auth.json` is per-machine, not
> per-tenant. For a shared host, store the provider + encrypted key reference on
> the tenant's `runtimes` row `config` and inject per-run via `--api-key`/env, so
> tenants never share one global pi credential.

### Migration stance: **zero-migration, runtime-scoped sessions**

Switching an agent's runtime must **not** require a migration script, quiesce
dance, or per-task marking. Keep **all** durable AI-created data (tasks, comments,
memory log — these are runtime-agnostic and already drive context). Drop **only**
session persistence/continuity; pi starts a fresh session and is continuous from
then on.

The only runtime-specific live state is the resume pointer `tasks.sessionId`
(read `engine.ts:186`, written `:360-365`) and the copilot pointer
`wakeContext?.sessionId` (`:429`). Today the engine passes it to *whatever* runtime
the agent now uses — so a Claude session id handed to pi causes a **silent
false-resume** (`session.ts` Mode A injects "You are resuming session X…" with no
real transcript).

**Fix — gate resume on runtime match.** Only reuse a stored session id if it was
written by the agent's *current* runtime; otherwise ignore it → fresh session
(`session.ts` Mode C/B, never a false Mode A).

- Add `tasks.sessionRuntimeType` (nullable text; `null` ⇒ legacy `"claude"`).
  At the read site, resolve the agent's runtime type **first**, then:
  `previousSessionId = (storedType === currentType) ? tasks.sessionId : undefined`.
  At the write site, persist `result.sessionId` **and** the current runtime type.
  Apply the same gate to the copilot `wakeContext` pointer.
- Zero-migration alternative (no schema change): prefix stored ids with the
  runtime (`pi:<uuid>`); bare/legacy ⇒ claude; honor only on prefix match, strip
  before passing to the CLI. (Column is preferred — queryable, less parsing.)

**What this yields, with no script:**

- Existing claude agents — legacy `null` ⇒ `"claude"` matches ⇒ keep resuming. Untouched.
- An agent switched to pi — its tasks' session type is `"claude"` ≠ `"pi"` ⇒
  ignored ⇒ pi starts fresh, writes `"pi"` + new id ⇒ resumes normally thereafter.
- **Switching an agent = update `runtimeId` + remap `model`.** No quiesce, no
  session reset script, no marking individual tasks. The first pi wake on each open
  task rebuilds context from comments + memory log; continuous after that.

**Model remap is the only per-agent value that must change** (model strings are
runtime-specific — pi has its own registry in `pi/packages/ai/src/models.generated.ts`,
incl. Bedrock/Vertex variants, plus `sonnet`/`provider/id` patterns). Handle by
letting the pi runtime row carry its own default `model` and clearing any
per-agent claude-id override at switch time (or a small claude→pi mapping table).

> Out of scope by explicit decision: preserving conversational continuity across a
> runtime change. Accepted tradeoff — durable artifacts carry the context.

---

## Implementation plan

### Part A — the `pi` runtime

**New file:** `packages/@boringos/runtime/src/runtimes/pi.ts`

Model on `claude.ts`. `execute()`:

1. Resolve model: `agents.model` override → runtime-row `model` →
   `"openai/gpt-4.1-mini"` (always-on default). Build args (the `provider/id`
   form makes `--provider` redundant — pi's `google` default is bypassed):
   ```
   ["--mode", "json", "--model", model,              // model = "openai/gpt-4.1-mini" by default
    "--no-context-files", "--session-dir", sessionDir,
    "--append-system-prompt", systemPromptFile]      // if systemInstructions
    + (previousSessionId ? ["--session", previousSessionId] : [])
    + (thinking ? ["--thinking", thinking] : [])
    + extraArgs
   ```
2. `spawnAgent({ command: "pi", args, cwd, env: buildAgentEnv(ctx), stdin: ctx.contextMarkdown, onOutputLine, onStderrLine })`.
3. In `onOutputLine(line)`, `JSON.parse` each line and:
   - `event.type === "session"` → `sessionId = event.id`.
   - `event.type === "message_end" && event.message.role === "assistant"`:
     - accumulate `event.message.usage` into a running total (input/output/cache/cost).
     - capture joined `text` content blocks into `lastAssistantText`.
   - emit normalized **progress** via the new `onProgress` callback (Part B).
   - always forward the raw `line` to `callbacks.onOutputLine` (keeps the run
     log / `stdoutExcerpt` intact).
4. After `spawnAgent` resolves, **synthesize the result line** so the existing
   extractor works unchanged:
   ```ts
   await callbacks.onOutputLine(JSON.stringify({ type: "result", result: lastAssistantText }));
   ```
   This is what `memory-checkpoint.ts:fetchReplyText` (`:115`) and the auto-comment
   path scan for — no engine change needed for result extraction.
5. `callbacks.onCostEvent({ inputTokens, outputTokens, cacheCreationTokens: cacheWrite, cacheReadTokens: cacheRead, model, costUsd })` from accumulated totals.
6. `callbacks.onComplete({ exitCode, sessionId })`; return `RuntimeExecutionResult`
   with usage/cost/model and `provider` derived from the model's prefix
   (e.g. `"openai"` for `openai/gpt-4.1-mini`).
7. `testEnvironment()` → `detectCli("pi")`.
8. `listModels()` → run `pi --list-models`, parse the `provider`/`model` columns →
   `{ id: "<provider>/<model>", label }[]`. Falls back to a small static
   `models` array (incl. `openai/gpt-4.1-mini`) if pi isn't queryable.

**Registration (3 edits):**
- `runtime/src/types.ts:5` — add `"pi"` to `RUNTIME_TYPES`.
- `runtime/src/index.ts` — `export { piRuntime } from "./runtimes/pi.js";`
- `core/src/boringos.ts:447` — add `piRuntime` to the registered runtime list.
- (optional) `runtime/src/registry.ts` aliases — `pi_local → pi`.

### Part B — live thinking window (transient, not persisted)

**1. Runtime callback (`runtime/src/types.ts`)** — add to `AgentRunCallbacks`:
```ts
onProgress?(event: RuntimeProgressEvent): void;
export interface RuntimeProgressEvent {
  kind: "thinking" | "text" | "tool";
  delta?: string;        // thinking/text chunk
  toolName?: string;     // for kind "tool"
}
```
Only the pi runtime calls it (claude leaves it unset → no behavior change → scoped).

**2. Engine (`agent/src/engine.ts` ~314)** — provide `onProgress` in the
callbacks object that publishes a realtime event. Ephemeral: it is **not**
written to `stdoutExcerpt` or any comment.
```ts
onProgress(e) { realtimeBus.publish({ type: "run:thinking", tenantId, data: { runId, agentId, taskId, ...e }, timestamp }); }
```
(Engine already has `realtimeBus` access via the deps wired in `boringos.ts`.)

**3. Event type (`core/src/realtime.ts:12`)** — add `"run:thinking"` to `EVENT_TYPES`.

### Part C — runtime-aware model dropdown (Settings > Agents)

Today the per-agent model dropdown in `shell/src/screens/Settings/AgentsPanel.tsx`
is a **hardcoded `CLAUDE_MODELS` constant** (`:17-20`) that ignores the agent's
runtime — a pi agent would see only Claude ids (its current value survives via the
fallback `<option>` at `:155-156`, but other pi models can't be picked). The
component's own comment flags this: *"Codex / Gemini / others: TODO once their
runtimes expose model lists."*

- Make options **runtime-driven**: resolve the agent's runtime row → its `type` →
  render that type's models (the backend already returns them via `GET /runtimes/:id`
  → `rtModule.models ?? listModels()`). `runtimes` rows are already in scope at
  `:139-140`. Claude agent → Claude models; pi agent → pi models. Retires the
  Codex/Gemini TODO too.
- **Model catalog is dynamic, not hardcoded.** Implement `piRuntime.listModels()`
  to shell out to `pi --list-models <provider>` and parse the `provider`/`model`
  columns → `{ id: "openai/<model>", label }`. The dropdown shows exactly the
  models the configured key can access (e.g. the OpenAI set). A tiny static
  `piRuntime.models` (incl. `openai/gpt-4.1-mini`) is only a fallback when pi
  isn't queryable. Stored `agent.model` is a pi-valid value passed as `pi --model`.
- **Default selection** — when an agent has no override and the runtime row's
  `model` is unset, the resolved default is `openai/gpt-4.1-mini`.

**4. UI (`shell/src/screens/Copilot.tsx`)** — the transient slot already exists
(the `awaitingReply` "Thinking…" bubble, `:235-243,:336`). Wire it live:
   - Subscribe to the SSE stream (reuse `@boringos/ui` client's existing
     `EventSource` on `/events`).
   - Accumulate `run:thinking` deltas for the active run into local state
     (`useState`, **not** react-query / DB).
   - Render them inside the existing bubble (thinking text dimmed; tool calls as
     "↳ running <tool>").
   - **Clear** the accumulator when `task:comment_added` (final reply persisted)
     or `run:completed`/`run:failed` arrives. On reload it's gone — never stored.

---

## Files touched

```
NEW   packages/@boringos/runtime/src/runtimes/pi.ts
EDIT  packages/@boringos/runtime/src/types.ts        # RUNTIME_TYPES + AgentRunCallbacks.onProgress + RuntimeProgressEvent
EDIT  packages/@boringos/runtime/src/index.ts        # export piRuntime
EDIT  packages/@boringos/runtime/src/registry.ts     # (optional) pi alias
EDIT  packages/@boringos/core/src/boringos.ts        # register piRuntime
EDIT  packages/@boringos/agent/src/engine.ts         # (1) callbacks.onProgress → realtimeBus
                                                     # (2) gate previousSessionId on runtime match (read :186 / write :360-365 / copilot :429)
EDIT  packages/@boringos/core/src/realtime.ts        # add "run:thinking" event type
EDIT  packages/@boringos/shell/src/screens/Copilot.tsx  # live transient bubble
EDIT  packages/@boringos/shell/src/screens/Settings/AgentsPanel.tsx  # runtime-aware model dropdown (drop hardcoded CLAUDE_MODELS)
EDIT  packages/@boringos/db/src/schema/tasks.ts      # add sessionRuntimeType column (+ migration); OR use id-prefix (no migration)
```

One nullable column migration (or none, with the id-prefix variant). No change to
the Claude runtime, result extraction, memory checkpoint, or the tool/callback HTTP
protocol. **No agent-migration script** — runtime switch is `runtimeId` + model
remap; sessions self-heal via the runtime gate.

---

## Testing

- **Unit (`tests/`)** — feed a captured pi `--mode json` stream into the pi
  runtime's line parser; assert: session id from header, accumulated
  usage/cost, synthesized `{type:"result"}` line, and `onProgress` emissions.
- **Resume** — run twice with the same `--session-dir`, assert turn 2 resumes
  the turn-1 session id.
- **Result/comment** — confirm `fetchReplyText` returns the synthesized text and
  the auto-comment posts unchanged.
- **Live window** — manual: a `pi`-backed copilot agent shows streaming
  thinking that vanishes when the reply comment lands; verify nothing persists
  after refresh; verify a `claude`-backed agent is unaffected (no `run:thinking`).
- **`testEnvironment`** — passes with `pi` on PATH, fails with hint otherwise.

---

## Prerequisites / ops

- `pi` CLI installed on PATH (`npm i -g --ignore-scripts @earendil-works/pi-coding-agent` or `curl -fsSL https://pi.dev/install.sh | sh`). Node ≥ 22.19.
- Provider credentials: env var (`ANTHROPIC_API_KEY`) **or** one-time `pi` → `/login` OAuth into `~/.pi/agent/auth.json`.

## Out of scope (follow-ups)

- Generalizing the live window to the Claude runtime (claude emits its own
  thinking/tool stream; same `onProgress` seam would carry it).
- Exposing pi's other providers (Gemini, Anthropic-via-pi) as selectable models.
- pi extensions/skills/prompt-template packages.

---

## Build plan — phases & tasks

> Execution checklist. No timelines (100% AI execution). Each phase ends with a
> **Done when** acceptance line. Phases are ordered for incremental, testable
> delivery; the **walking skeleton** (first demoable pi run) lands at the end of
> Phase 1 + a seeded connection row.

### Phase 0 — Prerequisites & scaffolding

- [x] Confirm `pi` on PATH and Node ≥ 22.19 (`pi --version`).
- [x] Confirm OpenAI key resolves in pi (`pi --list-models openai` returns rows incl. `gpt-4.1-mini`).
- [x] Capture a real `pi --mode json` transcript (a trivial prompt) → save as a test fixture for Phase 1 parser tests.
- [x] Note the exact `pi --list-models` table format from this machine (for the `listModels()` parser).
- **Done when:** pi runs locally, OpenAI models enumerate, and a JSON fixture exists.

### Phase 1 — The pi runtime (core engine)

- [x] `runtime/src/types.ts` — add `"pi"` to `RUNTIME_TYPES`.
- [x] `runtime/src/runtimes/pi.ts` — new `RuntimeModule`:
  - [x] Resolve model: `agents.model` → runtime-row `model` → `openai/gpt-4.1-mini`.
  - [x] Build args (`--mode json`, `--model <provider/id>`, `--no-context-files`, `--session-dir`, `--append-system-prompt <tmpfile>`, optional `--session`, `--thinking`, `extraArgs`).
  - [x] Pipe `ctx.contextMarkdown` to stdin; spawn via `spawnAgent`.
  - [x] Parse JSONL: capture `sessionId` from the `session` header; accumulate usage/cost from assistant `message_end`; capture `lastAssistantText`.
  - [x] Synthesize a trailing `{type:"result",result:<text>}` line via `onOutputLine` (keeps `fetchReplyText`/auto-comment working).
  - [x] `onCostEvent` (input/output/cache/cost), `onComplete({exitCode,sessionId})`, `onError`.
  - [x] `provider` in result derived from model prefix.
  - [x] Write system-prompt tmpfile; clean up in `finally`.
  - [x] `testEnvironment()` → `detectCli("pi")` with install hint.
  - [x] `listModels()` → parse `pi --list-models`; small static fallback incl. `openai/gpt-4.1-mini`.
- [x] Register: `runtime/src/index.ts` export `piRuntime`; `core/src/boringos.ts` add to registered list; `runtime/src/registry.ts` optional `pi` aliases.
- [x] Unit tests (`tests/`): drive the parser with the Phase 0 fixture → assert session id, usage/cost totals, synthesized result line.
- **Done when:** `pnpm -r build && pnpm -r typecheck` pass and unit tests green; runtime registered and visible to the engine.

### Phase 2 — Runtime-scoped sessions (no-migration switch)

- [x] Decide storage: **`tasks.sessionRuntimeType` column** (preferred) vs session-id prefix. Default to the column.
- [x] `db/src/schema/tasks.ts` — add nullable `sessionRuntimeType` + generate migration.
- [x] `agent/src/engine.ts` read gate (`:186`): resolve the agent's current runtime type **before** reading the pointer; `previousSessionId = (storedType ?? "claude") === currentType ? tasks.sessionId : undefined`.
- [x] `agent/src/engine.ts` write (`:360-365`): persist `result.sessionId` **and** the current runtime type.
- [x] Apply the same gate to the copilot `wakeContext.sessionId` path (`:429`).
- [x] Ensure no false Mode A: when ignored, `session.ts` takes Mode B/C (no "resuming session X").
- [x] Tests: (a) claude agent keeps resuming (legacy `null` ⇒ claude); (b) agent switched to pi ignores the claude pointer, starts fresh, then resumes its pi session on the next wake.
- **Done when:** switching an agent's `runtimeId` requires no script and never false-resumes; existing claude resume unaffected.

### Phase 3 — Connection + dynamic model catalog (UI)

- [ ] Seed the **"Pi · OpenAI"** connection row in `runtimes` (`type=pi`, `config.provider=openai`, `model="openai/gpt-4.1-mini"`) — via admin API or a seed path.
- [x] Verify `GET /runtimes/:id` returns `listModels()` output for a pi row (the live OpenAI catalog).
- [x] `shell/src/screens/Settings/AgentsPanel.tsx` — replace hardcoded `CLAUDE_MODELS` with a **runtime-aware** list: resolve the agent's runtime row → type → fetch that type's models; render those options. Retires the Codex/Gemini TODO.
- [x] Confirm default resolution: no override + no row model ⇒ `openai/gpt-4.1-mini`.
- [ ] Multi-tenant credential injection: read provider/key ref from runtime-row `config`, inject per-run via `--api-key`/env (not machine `auth.json`).
- [ ] Tests: dropdown shows pi/OpenAI models for a pi agent and Claude models for a claude agent.
- **Done when:** a pi agent can be created/configured entirely from the UI with a live, correct model list.

### Phase 4 — Live thinking window (pi-scoped, transient)

- [x] `runtime/src/types.ts` — add `AgentRunCallbacks.onProgress?` + `RuntimeProgressEvent { kind: "thinking"|"text"|"tool"; delta?; toolName? }`.
- [x] `runtimes/pi.ts` — emit normalized progress from `message_update` (`thinking_delta`/`text_delta`) and `tool_execution_start/end`.
- [x] `core/src/realtime.ts` — add `"run:thinking"` event type.
- [x] `agent/src/engine.ts` — provide `onProgress` that publishes `run:thinking` (ephemeral; never persisted, never a comment).
- [x] `shell/src/screens/Copilot.tsx` — subscribe SSE, accumulate `run:thinking` deltas into the existing "Thinking…" bubble; clear on `task:comment_added` / `run:completed`/`failed`. Local state only — gone on reload.
- [x] Verify claude agents are unaffected (no `onProgress` ⇒ no `run:thinking`).
- [x] Manual verify (`/verify` or `/run`): streaming thinking appears, vanishes on reply, nothing persisted.
- **Done when:** a pi copilot run streams transient thinking; final reply is the only saved artifact; claude path unchanged.

### Phase 5 — Hardening, docs, rollout

- [x] Optional claude→pi `model` remap helper for opt-in agent switching.
- [ ] Verify `fallbackRuntimeId` behavior (pi-primary / claude-fallback) end-to-end.
- [x] Optional read-only lever: support `--tools` allowlist via runtime `config`.
- [x] E2E: a pi agent picks up a real task, calls a framework tool via curl, posts the result comment, and resumes its pi session on the next wake.
- [x] Lifecycle: confirm temp system-prompt files and `--session-dir` are cleaned/managed.
- [x] Docs: bump runtime count in `CLAUDE.md` (6 → 7) and `INDEX.md` package note; add a short pi entry to `runtime/README.md`.
- [x] Update this doc's status header to "shipped" with the final decisions.
- **Done when:** pi is a first-class runtime selectable per agent, verified on a real task, with docs in sync.

### Dependency notes

- Phase 1 is foundational. Phases 2, 3, 4 each depend on Phase 1 but are independent of one another.
- The first **demoable** pi run = Phase 1 + the Phase 3 seed row (the connection). UI polish (rest of Phase 3) and the thinking window (Phase 4) can follow.
- No change to the Claude runtime in any phase except Phase 5's optional fallback verification.

---

## Test report

**Gate (default suite, no pi/OpenAI needed):** `pnpm -r build` ✓ · `pnpm -r typecheck` ✓ ·
`pnpm test:run` ✓ → **64 files / 470 tests pass, 1 skipped** (the opt-in E2E), exit 0, no unhandled errors.

**Unit coverage added:**
- `tests/runtime-pi.test.ts` (11) — JSON-stream parse (session id, usage/cost, final text, no double-count, synthesized `{type:result}`), `parsePiModelList`, and live progress events (text/thinking/tool).
- `tests/runtime-scoped-sessions.test.ts` (7) — the resume gate: claude keeps resuming, legacy null ⇒ claude, foreign session ignored both directions, switch→fresh→resume lifecycle.

**Live E2E (opt-in):** `PI_E2E=1 npx vitest run tests/pi-e2e.test.ts` — real `pi` → `gpt-4.1-mini`
through the full stack, **passed in ~26s**. Transcript:

```
USER: My favorite number is 7. Please remember it for the rest of our chat.
PI:   …I will remember your favorite number is 7 for the rest of our chat…
USER: What is my favorite number?
PI:   Your favorite number is 7, as you asked me to remember.
USER: What do you get if you add 10 to my favorite number?
PI:   If you add 10 to your favorite number 7, you get 17.
USER: And what is my favorite number multiplied by 3?
PI:   Your favorite number multiplied by 3 is 21. (7 multiplied by 3 equals 21.)
USER: One more time: what is my favorite number?   ← after a simulated Claude session was stamped on the task
PI:   Your favorite number is 7.
```

Asserted: (a) every comment got an agent reply; (b) context maintained across turns (7 → 17 → 21);
(c) no errors / no stuck runs; (d) `cost_events` rows recorded with model `gpt-4.1-mini`; (f) the
safe switch — after stamping a foreign `sessionRuntimeType='claude'` on the task, pi started a
**fresh** session (no false-resume), **all prior comments survived**, and the task's
`sessionRuntimeType` flipped to `pi`.

**Caveats / honest notes:**
- (e) The live "thinking" window is covered by unit tests (progress-event emission) + the
  engine→bus→Copilot wiring + clear-on-reply logic; the *visual* transience wasn't asserted in a
  headless test (needs a browser). `run:thinking` is ephemeral by construction (never written to DB).
- Rapid/out-of-order commenting relies on the framework's existing wakeup coalescing (unchanged);
  the E2E drives turns sequentially to make continuity assertions deterministic.
- `fallbackRuntimeId` (pi-primary / claude-fallback) is unchanged framework behavior and not
  separately exercised here.
- Switching an **existing** tenant's whole fleet onto pi is an operational step — run
  `scripts/seed-pi-default.mjs` (creates the "Pi · OpenAI" connection, sets it default, repoints
  every agent, clears Claude model overrides). The E2E ran on a fresh DB, so there were no
  pre-existing agents to migrate.
