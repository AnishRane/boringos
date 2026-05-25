#!/usr/bin/env node
// Switch tenants onto pi + gpt-4.1-mini as the default runtime.
//
// Idempotent: ensures a "Pi · OpenAI" runtime connection exists
// (type=pi, model=openai/gpt-4.1-mini), makes it the tenant default, and
// repoints every agent's runtimeId at it — clearing any per-agent model
// override (Claude model ids are not valid pi ids). Runs against a live
// BoringOS instance via the admin API; relies on the zero-migration
// runtime-scoped-session gate so no session data needs touching.
//
// Usage (single tenant):
//   BASE_URL=http://localhost:3000 ADMIN_KEY=<key> TENANT_ID=<uuid> \
//     node scripts/seed-pi-default.mjs
//
// Usage (all tenants — omit TENANT_ID):
//   BASE_URL=http://localhost:3000 ADMIN_KEY=<key> \
//     node scripts/seed-pi-default.mjs
//
// Existing Claude conversations simply start a fresh pi session on their
// next wake; all tasks/comments/memory are preserved.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.HEBBS_API_KEY;
const TENANT_ID = process.env.TENANT_ID;
const MODEL = process.env.PI_MODEL || "openai/gpt-4.1-mini";

if (!ADMIN_KEY) {
  console.error("Set ADMIN_KEY (or HEBBS_API_KEY). See header for usage.");
  process.exit(1);
}

const api = (p, tenantId) =>
  `${BASE_URL}/api/admin${p}`;

function headers(tenantId) {
  return {
    "Content-Type": "application/json",
    "X-API-Key": ADMIN_KEY,
    "X-Tenant-Id": tenantId,
  };
}

async function seedTenant(tenantId) {
  const h = headers(tenantId);
  console.log(`\n[tenant ${tenantId}]`);

  // 1. Ensure the Pi · OpenAI connection.
  const existing = await (await fetch(`${BASE_URL}/api/admin/runtimes`, { headers: h })).json();
  let pi = (existing.runtimes || existing || []).find((r) => r.type === "pi");
  if (!pi) {
    const res = await fetch(`${BASE_URL}/api/admin/runtimes`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ name: "Pi · OpenAI", type: "pi", config: { provider: "openai" }, model: MODEL }),
    });
    if (!res.ok) throw new Error(`create runtime failed: ${res.status} ${await res.text()}`);
    pi = await res.json();
    console.log(`  created pi runtime ${pi.id} (model ${MODEL})`);
  } else {
    await fetch(`${BASE_URL}/api/admin/runtimes/${pi.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ model: MODEL }) });
    console.log(`  reusing pi runtime ${pi.id} (model set to ${MODEL})`);
  }

  // 2. Make it the tenant default.
  await fetch(`${BASE_URL}/api/admin/runtimes/${pi.id}/default`, { method: "POST", headers: h, body: "{}" });
  console.log("  set as tenant default");

  // 3. Repoint every agent + clear any per-agent (Claude) model override.
  const agentsBody = await (await fetch(`${BASE_URL}/api/admin/agents`, { headers: h })).json();
  const agents = agentsBody.agents || agentsBody || [];
  let switched = 0;
  for (const a of agents) {
    const res = await fetch(`${BASE_URL}/api/admin/agents/${a.id}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ runtimeId: pi.id, model: null }),
    });
    if (res.ok) switched++;
    else console.error(`  agent ${a.id} (${a.name}) failed: ${res.status}`);
  }
  console.log(`  switched ${switched}/${agents.length} agents onto pi/${MODEL}`);
}

async function main() {
  if (TENANT_ID) {
    await seedTenant(TENANT_ID);
  } else {
    // Fetch all tenants and seed each one.
    const res = await fetch(`${BASE_URL}/api/admin/tenants`, {
      headers: {
        "X-API-Key": ADMIN_KEY,
        "X-Tenant-Id": "00000000-0000-0000-0000-000000000000",
      },
    });
    if (!res.ok) throw new Error(`list tenants failed: ${res.status} ${await res.text()}`);
    const tenants = await res.json();
    const list = Array.isArray(tenants) ? tenants : (tenants.tenants ?? []);
    if (list.length === 0) {
      console.error("No tenants found. Create a tenant first.");
      process.exit(1);
    }
    console.log(`Seeding ${list.length} tenant(s)...`);
    for (const t of list) {
      await seedTenant(t.id);
    }
  }
  console.log("\ndone — existing conversations start a fresh pi session on next wake; data preserved.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
