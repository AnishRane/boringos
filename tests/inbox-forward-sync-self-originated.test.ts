// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Coverage for the self-originated-mail guard in forward sync. Without
// it, an agent-sent reply bounces back through Gmail forward-sync, gets
// triaged as fresh inbound, and spawns CRM/enrichment fanout on the user
// themselves -- the exact runaway loop this ships to prevent (#14).

import { describe, it, expect } from "vitest";

import { selfOriginatedReason } from "@boringos/core";

const SELF = "parag.arora@gmail.com";

describe("selfOriginatedReason", () => {
  it("drops messages carrying the SENT label", () => {
    expect(
      selfOriginatedReason(
        { from: "Customer <buyer@acme.com>", labelIds: ["SENT", "IMPORTANT"] },
        SELF,
      ),
    ).toBe("gmail-label: SENT");
  });

  it("drops SENT messages even from a custom Send-As alias", () => {
    // The alias From does NOT match the connected account, so only the
    // label catches it -- the case the original bug report tripped on.
    expect(
      selfOriginatedReason(
        { from: "Parag Arora <parag@revelin7.com>", labelIds: ["SENT"] },
        SELF,
      ),
    ).toBe("gmail-label: SENT");
  });

  it("drops messages whose From matches the connected account", () => {
    expect(
      selfOriginatedReason({ from: `Parag <${SELF}>`, labelIds: [] }, SELF),
    ).toBe(`self-sender: ${SELF}`);
  });

  it("matches the connected account case-insensitively", () => {
    expect(
      selfOriginatedReason({ from: "PARAG.ARORA@GMAIL.COM", labelIds: [] }, SELF),
    ).toBe(`self-sender: ${SELF}`);
  });

  it("ingests genuine inbound mail", () => {
    expect(
      selfOriginatedReason(
        { from: "Customer <buyer@acme.com>", labelIds: ["INBOX", "IMPORTANT"] },
        SELF,
      ),
    ).toBeNull();
  });

  it("ingests when the account address is unknown and no SENT label", () => {
    expect(
      selfOriginatedReason({ from: "buyer@acme.com", labelIds: [] }, null),
    ).toBeNull();
  });

  it("tolerates missing from / labels", () => {
    expect(selfOriginatedReason({}, SELF)).toBeNull();
    expect(selfOriginatedReason({ from: null }, SELF)).toBeNull();
  });
});
