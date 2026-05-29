// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T6.4 fixture — depends on the `email-send` capability so the
// dev-host's `getAuthSteps()` walkthrough resolves to whichever
// built-in connector provides email (today: `@boringos/connector-google`).

import { z } from "@boringos/module-sdk";

export const createEmailNeedyModule = () => ({
  id: "email-needy",
  name: "Email Needy",
  version: "0.1.0",
  description: "Demo module — declares dependsOn capability:email-send",
  defaultInstall: false,
  dependsOn: [{ capability: "email-send" }],
  tools: [
    {
      name: "noop",
      description: "Returns ok — the test only needs registration to succeed",
      inputs: z.object({}),
      async handler() {
        return { ok: true, result: { said: "hello" } };
      },
    },
  ],
});

export default createEmailNeedyModule;
