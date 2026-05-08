// Throwaway: mint a callback JWT for a smoke test of /api/tools/*
import { signCallbackToken } from "@boringos/agent";

// Random UUIDs so the v2 dispatcher's tool_calls audit row gets
// valid uuid params (taskId is optional and stays unset).
import { randomUUID } from "node:crypto";

const tenantId = process.argv[2] ?? "8276fe9d-6e51-4ea0-a104-f2335f7200e5";
const token = signCallbackToken(
  {
    runId: randomUUID(),
    agentId: randomUUID(),
    tenantId,
  },
  process.env.JWT_SECRET ?? "boringos-dev-secret",
);
console.log(token);
