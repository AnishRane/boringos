/**
 * Inbox-pipeline effectiveness measurement.
 *
 * Boots a real BoringOS instance with embedded Postgres, simulates
 * a series of email events (without spawning real LLM subprocesses),
 * and reports the concrete metrics our 6 RC fixes target:
 *
 *   - tasks created per email (broken down by originKind + agent)
 *   - wakeups generated per email (proxy for LLM runs)
 *   - skill bytes that would be injected per agent run
 *   - HTTP round-trips per replier path (parsed from instructions)
 *
 * Run on each branch and diff the two JSON outputs:
 *
 *   git checkout main
 *   npx tsx scripts/measure-inbox-pipeline.ts --out main.json
 *   git checkout fix/inbox-pipeline-correctness
 *   npx tsx scripts/measure-inbox-pipeline.ts --out fix.json
 *   npx tsx scripts/measure-inbox-pipeline.ts --diff main.json fix.json
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const generateId = (): string => randomUUID();

import {
  BoringOS,
  createFrameworkModule,
  createInboxModule,
  createTriageModule,
  createInboxTriageModule,
  createInboxReplierModule,
  createMemoryModule,
  createWorkflowModule,
} from "@boringos/core";
import {
  agents,
  agentWakeupRequests,
  inboxItems,
  tasks,
  tenants,
  tenantSettings,
} from "@boringos/db";
import { and, eq } from "drizzle-orm";
import {
  createSkillRegistry,
  createToolRegistry,
} from "@boringos/agent";
import { createModuleRegistry } from "@boringos/agent";

// ── CLI ──────────────────────────────────────────────────────────────────

interface Args {
  out?: string;
  diff?: [string, string];
}

function parseArgs(): Args {
  const out: Args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--diff") out.diff = [argv[++i], argv[++i]];
  }
  return out;
}

// ── Scenarios ────────────────────────────────────────────────────────────

interface Scenario {
  id: string;
  label: "urgent" | "important" | "fyi" | "noise";
  rationale: string;
  automated: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    id: "urgent-customer",
    label: "urgent",
    rationale: "customer escalation thread",
    automated: false,
  },
  {
    id: "important-vendor",
    label: "important",
    rationale: "vendor proposal worth reviewing today",
    automated: false,
  },
  {
    id: "fyi-receipt",
    label: "fyi",
    rationale: "shipping confirmation, informational",
    automated: false,
  },
  {
    id: "noise-newsletter",
    label: "noise",
    rationale: "marketing newsletter",
    automated: false,
  },
];

// ── Metric collection ────────────────────────────────────────────────────

interface ScenarioMetrics {
  scenario: Scenario;
  tasksCreated: Array<{ originKind: string; assigneeAgentId: string | null }>;
  wakeupsCreated: number;
  totalLlmRuns: number; // proxy: distinct (agentId, taskId) pairs
}

interface BranchMetrics {
  branch: string;
  commit: string;
  timestamp: string;
  scenarios: ScenarioMetrics[];
  skillBytesPerAgent: {
    triage: { skillCount: number; totalBytes: number };
    replier: { skillCount: number; totalBytes: number };
    manual: { skillCount: number; totalBytes: number };
  };
  replierHttpCalls: {
    inSkipPath: number;
    inDraftPath: number;
  };
}

function gitInfo(): { branch: string; commit: string } {
  const branch = execSync("git rev-parse --abbrev-ref HEAD")
    .toString()
    .trim();
  const commit = execSync("git rev-parse --short HEAD").toString().trim();
  return { branch, commit };
}

// ── Skill-size measurement (independent of running BoringOS) ─────────────

async function measureSkillBytes(): Promise<BranchMetrics["skillBytesPerAgent"]> {
  const tools = createToolRegistry();
  const skills = createSkillRegistry();
  const modules = createModuleRegistry({ tools, skills });

  const deps = { db: null as never, memory: null };
  modules.register(createMemoryModule(deps));
  modules.register(createInboxModule(deps));
  modules.register(createTriageModule(deps));
  modules.register(createInboxTriageModule(deps));
  modules.register(createInboxReplierModule(deps));

  const measure = (taskOriginKind: string | undefined) => {
    const matching = skills.listApplicable({
      tenantId: "t",
      agentId: "a",
      agentRole: "operations",
      taskOriginKind,
    });
    return {
      skillCount: matching.length,
      totalBytes: matching.reduce(
        (sum, entry) => sum + entry.skill.body.length,
        0,
      ),
    };
  };

  return {
    triage: measure("inbox.item_created"),
    replier: measure("inbox.draft_reply"),
    manual: measure("manual"),
  };
}

// ── HTTP-call estimate from REPLIER_AGENT_INSTRUCTIONS ──────────────────

async function measureReplierHttpCalls(): Promise<
  BranchMetrics["replierHttpCalls"]
> {
  // Static analysis: read the replier instructions file and count
  // distinct framework tool curls. RC6 specifically gates
  // `framework.inbox.read` behind a label check, so on the fixed
  // branch the skip path has 1 call (tasks.patch only), draft path
  // has 3 (read + update + patch). On main, the skip path also has
  // 2 because the read is unconditional.
  const instructionsPath = join(
    process.cwd(),
    "packages/@boringos/core/src/modules/inbox-replier.ts",
  );
  let source = "";
  try {
    source = await readFile(instructionsPath, "utf8");
  } catch {
    return { inSkipPath: 2, inDraftPath: 3 };
  }

  // Extract the REPLIER_AGENT_INSTRUCTIONS string body — between
  // `REPLIER_AGENT_INSTRUCTIONS` (or _FOR_TEST) and the closing
  // `.join("\n");`. Cheap textual extraction; robust enough.
  const startMatch = source.match(
    /REPLIER_AGENT_INSTRUCTIONS(?:_FOR_TEST)?\s*=\s*\[([\s\S]+?)\]\.join/,
  );
  if (!startMatch) {
    return { inSkipPath: 2, inDraftPath: 3 };
  }
  const instructionString = startMatch[1];

  const allCurls =
    instructionString.match(/api\/tools\/[a-z.]+/g) ?? [];
  const uniqueTools = [...new Set(allCurls)];

  // Heuristic for the skip-path guard: is there a `SKIP immediately`
  // (or "go to Step 5") statement that appears BEFORE the first
  // `framework.inbox.read` reference AND the read is qualified with
  // "only if drafting"-style language?
  const readIdx = instructionString.search(/api\/tools\/framework\.inbox\.read/);
  const skipIdx = instructionString.search(/SKIP immediately|go to Step 5/i);
  const hasReadGuard =
    skipIdx > -1 &&
    readIdx > -1 &&
    skipIdx < readIdx &&
    /Only if you are going to draft|only if/i.test(
      instructionString.slice(Math.max(0, readIdx - 300), readIdx),
    );

  return {
    inSkipPath: hasReadGuard ? 1 : 2,
    inDraftPath: uniqueTools.length,
  };
}

// ── Pipeline simulation ──────────────────────────────────────────────────

async function runPipelineSimulation(): Promise<ScenarioMetrics[]> {
  const dataDir = await mkdtemp(join(tmpdir(), "boringos-bench-"));
  const port = 15600 + Math.floor(Math.random() * 100);
  const jwtSecret = "bench-secret";

  const app = new BoringOS({
    database: { embedded: true, dataDir, port },
    drive: { root: join(dataDir, "drive") },
    auth: { secret: jwtSecret },
  });
  app.module(createFrameworkModule);
  app.module(createMemoryModule);
  app.module(createInboxModule);
  app.module(createTriageModule);
  app.module(createWorkflowModule);

  const server = await app.listen(0);
  const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
  const eventBus = (server as unknown as {
    context: { eventBus?: { emit: (e: Record<string, unknown>) => Promise<void> } };
  }).context.eventBus;
  if (!eventBus) {
    throw new Error("eventBus not available on context");
  }

  // Seed a tenant + the named root agent (default-app catalog names
  // are what the inbox workflows install their agents under).
  const tenantId = "11111111-1111-4111-8111-111111111111";

  await db
    .insert(tenants)
    .values({ id: tenantId, name: "bench", slug: "bench" })
    .onConflictDoNothing();

  // Need a runtime for the inbox-triage / inbox-replier installers
  // to attach their agents to.
  const { runtimes } = await import("@boringos/db");
  const runtimeId = generateId();
  await db
    .insert(runtimes)
    .values({
      id: runtimeId,
      tenantId,
      type: "claude",
      name: "bench-claude",
      command: "echo",
      enabled: true,
    })
    .onConflictDoNothing();

  // Run the inbox-triage and inbox-replier install handlers directly.
  // They insert their agent + workflow rows into the freshly-created
  // tenant. This is what would happen at onTenantCreate in a real
  // boot, just done manually for the bench.
  const triageModule = createInboxTriageModule({ db });
  const replierModule = createInboxReplierModule({ db });
  await triageModule.lifecycle?.onInstall?.({ tenantId, moduleId: "inbox-triage" });
  await replierModule.lifecycle?.onInstall?.({ tenantId, moduleId: "inbox-replier" });

  // Find the installed agents by name so the bench can identify
  // triage vs replier tasks downstream.
  const triageAgentRow = await db
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.name, "Generic Inbox Triage")))
    .limit(1);
  const replierAgentRow = await db
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.name, "Generic Email Replier")))
    .limit(1);
  const triageAgentId = triageAgentRow[0]?.id ?? "<not-found>";
  const replierAgentId = replierAgentRow[0]?.id ?? "<not-found>";

  // Pause agents so no LLM subprocesses spawn.
  await db
    .insert(tenantSettings)
    .values({ tenantId, key: "agents_paused", value: "true" })
    .onConflictDoNothing();
  await db
    .update(agents)
    .set({ status: "paused", pauseReason: "bench-test" })
    .where(eq(agents.tenantId, tenantId));

  // Helper: snapshot row counts to diff after each scenario.
  async function snapshot() {
    const taskRows = await db.select().from(tasks).where(eq(tasks.tenantId, tenantId));
    const wakeRows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.tenantId, tenantId));
    return { taskCount: taskRows.length, wakeCount: wakeRows.length, taskRows };
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const results: ScenarioMetrics[] = [];

  for (const scenario of SCENARIOS) {
    // Insert a fresh inbox item
    const itemId = generateId();
    await db.insert(inboxItems).values({
      id: itemId,
      tenantId,
      source: "google.gmail",
      sourceId: scenario.id,
      subject: `Subject for ${scenario.id}`,
      body: "Body",
      from: "jane@example.com",
      status: "unread",
      metadata: {
        email: {
          headers: {},
          automated: scenario.automated
            ? { automated: true, kind: "newsletter", reasons: ["test"] }
            : { automated: false, kind: null, reasons: [] },
        },
      },
    });

    const before = await snapshot();

    // 1) Emit inbox.item_created → workflow dispatcher fires
    await eventBus.emit({
      connectorKind: "google",
      type: "inbox.item_created",
      tenantId,
      timestamp: new Date(),
      data: {
        itemId,
        source: "google.gmail",
        sourceId: scenario.id,
        subject: `Subject for ${scenario.id}`,
        from: "jane@example.com",
        body: "Body",
        headers: {},
        automated: scenario.automated
          ? { automated: true, kind: "newsletter", reasons: ["test"] }
          : { automated: false, kind: null, reasons: [] },
      },
    });
    await sleep(600);

    // 2) Simulate triage running: write metadata.triage + emit triage.classified
    //    (the actual triage agent is paused, so we play its role).
    await db
      .update(inboxItems)
      .set({
        metadata: {
          email: {
            headers: {},
            automated: { automated: false, kind: null, reasons: [] },
          },
          triage: {
            label: scenario.label,
            rationale: scenario.rationale,
            classifiedAt: new Date().toISOString(),
            source: "agent",
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(inboxItems.id, itemId));

    await eventBus.emit({
      connectorKind: "framework",
      type: "triage.classified",
      tenantId,
      timestamp: new Date(),
      data: {
        itemId,
        label: scenario.label,
        source: "agent",
        rationale: scenario.rationale,
      },
    });
    await sleep(800);

    const after = await snapshot();
    const newTasks = after.taskRows.filter(
      (t) => t.originId === itemId || t.description?.includes(itemId),
    );

    // Distinct (agent, task) pairs from wakeup requests — proxy for LLM runs.
    const wakeRows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.tenantId, tenantId));
    const newWakes = wakeRows.filter(
      (w) => newTasks.some((t) => t.id === w.taskId),
    );

    results.push({
      scenario,
      tasksCreated: newTasks.map((t) => ({
        originKind: t.originKind ?? "",
        assigneeAgentId: t.assigneeAgentId,
      })),
      wakeupsCreated: newWakes.length,
      totalLlmRuns: newWakes.length,
    });
  }

  await server.close();
  return results;
}

// ── Markdown summary ─────────────────────────────────────────────────────

function renderMarkdown(m: BranchMetrics): string {
  const lines: string[] = [];
  lines.push(`# Inbox Pipeline Metrics — ${m.branch} @ ${m.commit}`);
  lines.push(`Captured ${m.timestamp}`);
  lines.push("");
  lines.push("## Tasks + LLM runs per email scenario");
  lines.push("");
  lines.push("| Scenario | Label | Tasks | Replier tasks | Triage tasks | LLM runs |");
  lines.push("|---|---|---|---|---|---|");
  for (const s of m.scenarios) {
    const replier = s.tasksCreated.filter(
      (t) => t.originKind === "inbox.draft_reply",
    ).length;
    const triage = s.tasksCreated.filter(
      (t) => t.originKind === "inbox.item_created",
    ).length;
    lines.push(
      `| ${s.scenario.id} | ${s.scenario.label} | ${s.tasksCreated.length} | ${replier} | ${triage} | ${s.totalLlmRuns} |`,
    );
  }
  lines.push("");
  lines.push("## Skill bytes injected per agent (per run)");
  lines.push("");
  lines.push("| Agent type | Skill count | Skill bytes |");
  lines.push("|---|---|---|");
  lines.push(`| Triage (inbox.item_created task) | ${m.skillBytesPerAgent.triage.skillCount} | ${m.skillBytesPerAgent.triage.totalBytes} |`);
  lines.push(`| Replier (inbox.draft_reply task) | ${m.skillBytesPerAgent.replier.skillCount} | ${m.skillBytesPerAgent.replier.totalBytes} |`);
  lines.push(`| Manual (originKind=manual) | ${m.skillBytesPerAgent.manual.skillCount} | ${m.skillBytesPerAgent.manual.totalBytes} |`);
  lines.push("");
  lines.push("## Replier HTTP calls (parsed from REPLIER_AGENT_INSTRUCTIONS)");
  lines.push("");
  lines.push(`- Skip path (noise/fyi): ${m.replierHttpCalls.inSkipPath} call(s)`);
  lines.push(`- Draft path (urgent/important): ${m.replierHttpCalls.inDraftPath} call(s)`);
  return lines.join("\n");
}

// ── Diff renderer ────────────────────────────────────────────────────────

async function runDiff(aPath: string, bPath: string): Promise<void> {
  const [a, b] = await Promise.all([
    readFile(aPath, "utf8").then((s) => JSON.parse(s) as BranchMetrics),
    readFile(bPath, "utf8").then((s) => JSON.parse(s) as BranchMetrics),
  ]);

  console.log(
    `\nDiff: ${a.branch} @ ${a.commit}  →  ${b.branch} @ ${b.commit}\n`,
  );

  console.log("Tasks created per email:");
  console.log("| Scenario | label | A tasks | B tasks | Δ |");
  console.log("|---|---|---|---|---|");
  for (let i = 0; i < a.scenarios.length; i += 1) {
    const aS = a.scenarios[i];
    const bS = b.scenarios[i];
    const aT = aS.tasksCreated.length;
    const bT = bS.tasksCreated.length;
    console.log(
      `| ${aS.scenario.id} | ${aS.scenario.label} | ${aT} | ${bT} | ${bT - aT >= 0 ? "+" : ""}${bT - aT} |`,
    );
  }

  console.log("\nSkill bytes per agent:");
  console.log("| Agent | A bytes | B bytes | Δ | % change |");
  console.log("|---|---|---|---|---|");
  for (const k of ["triage", "replier", "manual"] as const) {
    const av = a.skillBytesPerAgent[k].totalBytes;
    const bv = b.skillBytesPerAgent[k].totalBytes;
    const pct = av === 0 ? "n/a" : `${(((bv - av) / av) * 100).toFixed(1)}%`;
    console.log(
      `| ${k} | ${av} | ${bv} | ${bv - av >= 0 ? "+" : ""}${bv - av} | ${pct} |`,
    );
  }

  console.log("\nReplier HTTP calls:");
  console.log(
    `  skip path: ${a.replierHttpCalls.inSkipPath} → ${b.replierHttpCalls.inSkipPath}`,
  );
  console.log(
    `  draft path: ${a.replierHttpCalls.inDraftPath} → ${b.replierHttpCalls.inDraftPath}`,
  );
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (args.diff) {
    await runDiff(args.diff[0], args.diff[1]);
    return;
  }

  const { branch, commit } = gitInfo();
  console.log(`Measuring inbox pipeline on ${branch} @ ${commit}...`);

  const scenarios = await runPipelineSimulation();
  const skillBytesPerAgent = await measureSkillBytes();
  const replierHttpCalls = await measureReplierHttpCalls();

  const out: BranchMetrics = {
    branch,
    commit,
    timestamp: new Date().toISOString(),
    scenarios,
    skillBytesPerAgent,
    replierHttpCalls,
  };

  const outPath =
    args.out ?? `inbox-pipeline-metrics-${branch.replace(/\//g, "_")}-${commit}.json`;
  await writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log("\n" + renderMarkdown(out));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
