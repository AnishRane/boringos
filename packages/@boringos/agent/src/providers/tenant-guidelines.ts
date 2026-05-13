import type { ContextProvider, ContextBuildEvent } from "../types.js";

interface BusinessProfile {
  industry?: string | null;
  whatWeDo?: string | null;
  idealCustomer?: string | null;
  signalExamples?: string[];
  noiseExamples?: string[];
  competitors?: string[];
  tone?: string | null;
}

function formatBusinessProfile(profile: BusinessProfile): string | null {
  const lines: string[] = [];
  if (profile.industry) lines.push(`**Industry:** ${profile.industry}`);
  if (profile.whatWeDo) lines.push(`**What we do:** ${profile.whatWeDo}`);
  if (profile.idealCustomer)
    lines.push(`**Ideal customer:** ${profile.idealCustomer}`);
  if (profile.tone) lines.push(`**Tone:** ${profile.tone}`);
  if (profile.competitors && profile.competitors.length > 0) {
    lines.push(`**Competitors:** ${profile.competitors.join(", ")}`);
  }
  if (profile.signalExamples && profile.signalExamples.length > 0) {
    lines.push(
      `**Signal (emails that matter):**\n${profile.signalExamples.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  if (profile.noiseExamples && profile.noiseExamples.length > 0) {
    lines.push(
      `**Noise (emails to ignore):**\n${profile.noiseExamples.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  if (lines.length === 0) return null;
  return `## Business Context\n\n${lines.join("\n\n")}`;
}

export function createTenantGuidelinesProvider(deps: { db: unknown }): ContextProvider {
  return {
    name: "tenant-guidelines",
    phase: "system",
    priority: 20,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      try {
        const { eq, and } = await import("drizzle-orm");
        const { tenantSettings } = await import("@boringos/db");
        const db = deps.db as import("@boringos/db").Db;

        const rows = await db
          .select()
          .from(tenantSettings)
          .where(and(
            eq(tenantSettings.tenantId, event.tenantId),
            // value is fetched per-key below; this select is the small
            // shared scan
          ));

        const byKey = new Map<string, string | null>();
        for (const r of rows) byKey.set(r.key, r.value ?? null);

        const blocks: string[] = [];
        const baseInstructions = byKey.get("base_instructions");
        if (baseInstructions) {
          blocks.push(`## Company Guidelines\n\n${baseInstructions}`);
        }
        const bizRaw = byKey.get("business_profile");
        if (bizRaw) {
          try {
            const profile = JSON.parse(bizRaw) as BusinessProfile;
            const formatted = formatBusinessProfile(profile);
            if (formatted) blocks.push(formatted);
          } catch {
            // ignore malformed json
          }
        }

        if (blocks.length === 0) return null;
        return blocks.join("\n\n");
      } catch {
        return null;
      }
    },
  };
}
