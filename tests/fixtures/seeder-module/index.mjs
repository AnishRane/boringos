// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T7.1 fixture — exercises both seeding paths.
//   - Declarative: top-level `agents`, `workflows`, `routines` →
//     framework auto-seeds them after onInstall.
//   - Imperative: onInstall calls Lifecycle.seed with one extra
//     agent so we can assert both code paths ran.

import { Lifecycle, z } from "@boringos/module-sdk";

export const createSeederModule = () => ({
  id: "seeder",
  name: "Seeder Demo",
  version: "0.1.0",
  description: "Demo module — exercises declarative + imperative seeds",
  defaultInstall: false,
  agents: [
    {
      name: "Seeder Auto Agent",
      persona: "general",
      instructions: "Auto-seeded via the declarative path.",
    },
  ],
  workflows: [
    {
      name: "Seeder Auto Workflow",
      description: "Auto-seeded workflow",
      blocks: [
        { id: "n1", kind: "trigger", config: { type: "manual" } },
      ],
      edges: [],
    },
  ],
  routines: [
    {
      id: "seeder-auto-routine",
      title: "Seeder Auto Routine",
      trigger: { type: "cron", expression: "0 9 * * *", timezone: "UTC" },
      tool: "framework.agents.wake",
      enabled: true,
    },
  ],
  tools: [
    {
      name: "noop",
      description: "no-op",
      inputs: z.object({}),
      async handler() {
        return { ok: true, result: {} };
      },
    },
  ],
  lifecycle: {
    async onInstall(ctx) {
      // Imperative seed for an agent the declarative path can't
      // express (here it's just a second agent with a custom name
      // — the real-world case is precondition resolution).
      await Lifecycle.seed(ctx, {
        agents: [
          {
            name: "Seeder Imperative Agent",
            persona: "general",
            instructions: "Seeded via Lifecycle.seed from onInstall.",
          },
        ],
      });
    },
  },
});

export default createSeederModule;
