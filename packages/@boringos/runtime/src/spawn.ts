import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Readable } from "node:stream";
import type { AgentRunCallbacks, RuntimeExecutionContext } from "./types.js";

const execFileAsync = promisify(execFile);

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  /**
   * Idle watchdog: kill the process if it produces no stdout/stderr for
   * this many ms. 0 disables. When unset, defaults to
   * `BORINGOS_AGENT_IDLE_TIMEOUT_MS` (or 7 min). Distinct from `timeoutMs`,
   * which is a hard wall-clock cap regardless of activity.
   */
  idleTimeoutMs?: number;
  onOutputLine?: AgentRunCallbacks["onOutputLine"];
  onStderrLine?: AgentRunCallbacks["onStderrLine"];
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when the idle watchdog killed the process (presumed stuck). */
  idleTimedOut: boolean;
}

const DEFAULT_IDLE_TIMEOUT_MS = 7 * 60_000;

function resolveIdleTimeoutMs(explicit: number | undefined): number {
  if (explicit !== undefined) return explicit;
  const env = process.env.BORINGOS_AGENT_IDLE_TIMEOUT_MS;
  if (env !== undefined) {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_IDLE_TIMEOUT_MS;
}

export function buildAgentEnv(ctx: RuntimeExecutionContext): Record<string, string> {
  const env: Record<string, string> = {
    BORINGOS_CALLBACK_URL: ctx.callbackUrl,
    BORINGOS_CALLBACK_TOKEN: ctx.callbackToken,
    BORINGOS_RUN_ID: ctx.runId,
    BORINGOS_AGENT_ID: ctx.agentId,
    BORINGOS_TENANT_ID: ctx.tenantId,
    // Agents run headless — force matplotlib's non-interactive backend so a
    // generated plot can never pop a GUI window (which would block the run).
    MPLBACKEND: "Agg",
  };

  if (ctx.taskId) env["BORINGOS_TASK_ID"] = ctx.taskId;
  if (ctx.wakeReason) env["BORINGOS_WAKE_REASON"] = ctx.wakeReason;
  if (ctx.workspaceCwd) env["BORINGOS_WORKSPACE_CWD"] = ctx.workspaceCwd;
  if (ctx.workspaceBranch) env["BORINGOS_WORKSPACE_BRANCH"] = ctx.workspaceBranch;

  if (ctx.extraEnv) {
    for (const [k, v] of Object.entries(ctx.extraEnv)) {
      env[k] = v;
    }
  }

  return env;
}

export async function spawnAgent(opts: SpawnOptions): Promise<SpawnResult> {
  const effectiveEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") effectiveEnv[k] = v;
  }
  for (const [k, v] of Object.entries(opts.env)) {
    effectiveEnv[k] = v;
  }

  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: effectiveEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5000);
    }, opts.timeoutMs);
  }

  // Idle watchdog. Resets on every chunk of stdout/stderr; if the process
  // goes silent for the full window it's presumed stuck and killed. This is
  // the generic, runtime-agnostic guard against a hung CLI leaving an
  // orphaned `running` run row (only a server restart would otherwise clean
  // it up). The kill flows through the normal exit path → run is marked
  // failed → the task hands back to a human.
  const idleTimeoutMs = resolveIdleTimeoutMs(opts.idleTimeoutMs);
  let idleHandle: ReturnType<typeof setTimeout> | undefined;
  let idleKillTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimedOut = false;
  const clearIdle = () => {
    if (idleHandle) clearTimeout(idleHandle);
    idleHandle = undefined;
  };
  const armIdle = () => {
    if (!(idleTimeoutMs > 0) || child.killed) return;
    clearIdle();
    idleHandle = setTimeout(() => {
      idleTimedOut = true;
      child.kill("SIGTERM");
      idleKillTimer = setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5000);
    }, idleTimeoutMs);
  };
  // Arm immediately so a process that never emits anything is still caught.
  armIdle();

  if (child.stdin && opts.stdin) {
    child.stdin.write(opts.stdin, "utf8");
    child.stdin.end();
  }

  const processStream = async (stream: Readable, lines: string[], cb?: (line: string) => void | Promise<void>) => {
    let buffer = "";
    for await (const chunk of stream) {
      armIdle(); // activity → reset the idle window
      buffer += chunk.toString("utf8");
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        lines.push(line);
        if (cb) await cb(line);
      }
    }
    if (buffer) {
      lines.push(buffer);
      if (cb) await cb(buffer);
    }
  };

  const stdoutP = child.stdout ? processStream(child.stdout, stdoutLines, opts.onOutputLine) : Promise.resolve();
  const stderrP = child.stderr ? processStream(child.stderr, stderrLines, opts.onStderrLine) : Promise.resolve();

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  await Promise.all([stdoutP, stderrP]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  clearIdle();
  if (idleKillTimer) clearTimeout(idleKillTimer);

  return { exitCode, stdout: stdoutLines.join("\n"), stderr: stderrLines.join("\n"), idleTimedOut };
}

export async function detectCli(command: string): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout } = await execFileAsync("which", [command]);
    return { available: stdout.trim().length > 0 };
  } catch {
    return { available: false };
  }
}
