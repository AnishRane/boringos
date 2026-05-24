import { writeFile, unlink, mkdtemp, rmdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type {
  RuntimeModule,
  RuntimeExecutionContext,
  RuntimeExecutionResult,
  AgentRunCallbacks,
  RuntimeModel,
} from "../types.js";
import { spawnAgent, buildAgentEnv, detectCli } from "../spawn.js";

const execFileAsync = promisify(execFile);

// Always-on default model for the pi runtime (provider-qualified so
// pi's `google` default is never used). Resolution order in execute():
// per-agent agents.model → runtime-row model → this default.
export const PI_DEFAULT_MODEL = "openai/gpt-4.1-mini";

const FALLBACK_MODELS: RuntimeModel[] = [
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini (OpenAI)" },
  { id: "openai/gpt-4.1", label: "GPT-4.1 (OpenAI)" },
  { id: "openai/gpt-4o", label: "GPT-4o (OpenAI)" },
];

// ── pi `--mode json` event shapes (only the fields we read) ──────────────────
interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}
interface PiContentBlock {
  type?: string;
  text?: string;
}
interface PiMessage {
  role?: string;
  content?: PiContentBlock[];
  usage?: PiUsage;
  model?: string;
  provider?: string;
}
interface PiEvent {
  type?: string;
  id?: string;
  message?: PiMessage;
}

export interface PiStreamState {
  sessionId?: string;
  lastAssistantText: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  sawUsage: boolean;
  model?: string;
  provider?: string;
}

/**
 * Pure, testable parser for pi's `--mode json` stdout. One JSON event per line.
 *
 * We only read: the `session` header (id), and assistant `message_end` events
 * (usage/cost + final text). Streaming `message_update` events carry zero-usage
 * partials and `turn_end`/`agent_end` repeat the same assistant message, so we
 * accumulate **only on `message_end`** to avoid double counting.
 *
 * pi never emits a `{type:"result"}` line (Claude does); `resultLine()`
 * synthesizes one from the final assistant text so the framework's reply
 * extraction (memory-checkpoint, auto-comment) keeps working unchanged.
 */
export function createPiStreamParser() {
  const state: PiStreamState = {
    lastAssistantText: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    sawUsage: false,
  };

  function push(line: string): void {
    let event: PiEvent;
    try {
      event = JSON.parse(line) as PiEvent;
    } catch {
      return; // not JSON — raw text, ignore
    }
    if (!event || typeof event !== "object") return;

    if (event.type === "session" && typeof event.id === "string") {
      state.sessionId = event.id;
      return;
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      const m = event.message;
      if (m.usage) {
        state.inputTokens += m.usage.input ?? 0;
        state.outputTokens += m.usage.output ?? 0;
        state.cacheReadTokens += m.usage.cacheRead ?? 0;
        state.cacheWriteTokens += m.usage.cacheWrite ?? 0;
        state.costUsd += m.usage.cost?.total ?? 0;
        state.sawUsage = true;
      }
      if (typeof m.model === "string") state.model = m.model;
      if (typeof m.provider === "string") state.provider = m.provider;
      if (Array.isArray(m.content)) {
        const text = m.content
          .filter((c) => c?.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("");
        if (text) state.lastAssistantText = text;
      }
    }
  }

  function resultLine(): string {
    return JSON.stringify({ type: "result", result: state.lastAssistantText });
  }

  return { state, push, resultLine };
}

/**
 * Parse `pi --list-models` table output into RuntimeModel[]. Columns are:
 * `provider model context max-out thinking images`. Returns `<provider>/<id>`
 * model ids (provider-qualified, the form execute() passes to `pi --model`).
 */
export function parsePiModelList(stdout: string): RuntimeModel[] {
  const models: RuntimeModel[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+\S+/);
    if (!m) continue;
    const [, provider, model] = m;
    if (provider === "provider") continue; // header row
    if (!/^[a-z0-9.\-]+$/i.test(provider)) continue; // defensive
    models.push({ id: `${provider}/${model}`, label: `${model} (${provider})` });
  }
  return models;
}

export const piRuntime: RuntimeModule = {
  type: "pi",

  models: FALLBACK_MODELS,

  skillMarkdown() {
    return "This agent runs on the pi coding agent CLI (pi.dev). It can read/write files, run shell commands, and call BoringOS tools over HTTP.";
  },

  async execute(
    ctx: RuntimeExecutionContext,
    callbacks: AgentRunCallbacks,
  ): Promise<RuntimeExecutionResult> {
    const config = ctx.config as Record<string, string | string[] | undefined>;
    const command = (config.command as string) ?? "pi";
    const model = (config.model as string) ?? PI_DEFAULT_MODEL;
    const cwd = ctx.workspaceCwd ?? process.cwd();
    // Stable, per-(tenant,agent) session store so `--session <id>` resolves
    // across per-run ephemeral workdirs (the cwd is recreated each run).
    const sessionDir =
      (config.sessionDir as string) ??
      join(homedir(), ".boringos", "pi-sessions", ctx.tenantId, ctx.agentId);

    const args = [
      "--mode",
      "json",
      "--model",
      model,
      "--no-context-files",
      "--session-dir",
      sessionDir,
    ];
    if (ctx.previousSessionId) args.push("--session", ctx.previousSessionId);

    const thinking = config.thinking as string | undefined;
    if (thinking) args.push("--thinking", thinking);

    const extraArgs = config.extraArgs as string[] | undefined;
    if (Array.isArray(extraArgs)) args.push(...extraArgs);

    let systemPromptFile: string | undefined;
    let tempDir: string | undefined;
    const parser = createPiStreamParser();

    try {
      await mkdir(sessionDir, { recursive: true }).catch(() => {});

      if (ctx.systemInstructions) {
        tempDir = await mkdtemp(join(tmpdir(), "boringos-pi-"));
        systemPromptFile = join(tempDir, "system-prompt.md");
        await writeFile(systemPromptFile, ctx.systemInstructions, "utf8");
        // pi reads --append-system-prompt as a file when the arg is an
        // existing path (resource-loader resolvePromptInput), so large
        // system prompts dodge ARG_MAX — same role as Claude's
        // --append-system-prompt-file.
        args.push("--append-system-prompt", systemPromptFile);
      }

      const env = buildAgentEnv(ctx);

      const result = await spawnAgent({
        command,
        args,
        cwd,
        env,
        stdin: ctx.contextMarkdown,
        onOutputLine: async (line) => {
          parser.push(line);
          await callbacks.onOutputLine(line);
        },
        onStderrLine: callbacks.onStderrLine,
      });

      // Synthesize the result line pi doesn't emit (see createPiStreamParser).
      await callbacks.onOutputLine(parser.resultLine());

      const s = parser.state;
      if (s.sawUsage) {
        callbacks.onCostEvent({
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
          cacheCreationTokens: s.cacheWriteTokens,
          cacheReadTokens: s.cacheReadTokens,
          model: s.model ?? model,
          costUsd: s.costUsd,
        });
      }
      callbacks.onComplete({ exitCode: result.exitCode, sessionId: s.sessionId });

      return {
        exitCode: result.exitCode,
        sessionId: s.sessionId,
        usage: s.sawUsage
          ? {
              inputTokens: s.inputTokens,
              outputTokens: s.outputTokens,
              cachedInputTokens: s.cacheReadTokens,
            }
          : undefined,
        costUsd: s.sawUsage ? s.costUsd : undefined,
        model: s.model ?? model,
        provider: s.provider ?? (model.includes("/") ? model.split("/")[0] : "openai"),
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      return { exitCode: 1, errorMessage: error.message };
    } finally {
      if (systemPromptFile) await unlink(systemPromptFile).catch(() => {});
      if (tempDir) await rmdir(tempDir).catch(() => {});
    }
  },

  async testEnvironment() {
    const { available } = await detectCli("pi");
    return {
      status: available ? ("pass" as const) : ("fail" as const),
      checks: [
        {
          code: "pi_cli_available",
          level: available ? ("info" as const) : ("error" as const),
          message: available ? "pi CLI found on PATH" : "pi CLI not found",
          hint: available
            ? undefined
            : "Install pi: npm i -g @earendil-works/pi-coding-agent (or https://pi.dev/install.sh)",
        },
      ],
      testedAt: new Date().toISOString(),
    };
  },

  async listModels() {
    try {
      const { stdout } = await execFileAsync("pi", ["--list-models"], {
        maxBuffer: 8 * 1024 * 1024,
      });
      const models = parsePiModelList(stdout);
      return models.length > 0 ? models : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  },
};
