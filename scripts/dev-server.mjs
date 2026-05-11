// SPDX-License-Identifier: MIT
//
// Dev server. Boots @boringos/core on port 3030 with embedded
// Postgres so the @boringos/shell SPA (port 5174) has a real
// /api/* backend to sign up + admin against.

import {
  BoringOS,
  createFrameworkModule,
  createMemoryModule,
  createDriveModule,
  createInboxModule,
  createWorkflowModule,
  createCopilotModule,
  createSlackModule,
  createGoogleModule,
  createTriageModule,
  createInboxTriageModule,
  createInboxReplierModule,
} from "@boringos/core";
import { createCrmModule } from "@boringos-crm/server";

const port = Number(process.env.PORT ?? 3030);
const pgPort = Number(process.env.PG_PORT ?? 5436);
const shellOrigin = process.env.BORINGOS_SHELL_URL ?? "http://localhost:5174";

const app = new BoringOS({
  database: { embedded: true, port: pgPort },
  shellOrigin,
  // Each queue slot spawns its own claude subprocess; 5 = ~5x burst
  // throughput. Tune per-box; production should profile.
  queue: { concurrency: 5 },
});

// Modules — register every plugin the host knows about. The
// install-manager auto-installs `defaultInstall: true` modules on
// new tenants; modules with `defaultInstall: false` (like CRM)
// require explicit /api/admin/modules/<id>/install.
app.module(createFrameworkModule);
app.module(createMemoryModule);
app.module(createDriveModule);
app.module(createInboxModule);
app.module(createWorkflowModule);
app.module(createCopilotModule);
app.module(createSlackModule);
app.module(createGoogleModule);
app.module(createTriageModule);
app.module(createInboxTriageModule);
app.module(createInboxReplierModule);
app.module(createCrmModule);

const server = await app.listen(port);

console.log(`[dev-server] BoringOS listening at ${server.url}`);
console.log(`[dev-server] Health: ${server.url}/health`);
console.log(`[dev-server] Press Ctrl+C to stop`);
