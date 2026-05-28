// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit tests for AuthManager registry surface.
//
// These tests exercise the in-memory connector registry without requiring a
// real database. Integration tests with DB are deferred to the E2E gate.

import { describe, it, expect } from "vitest";
import { AuthManager } from "../src/auth-manager.js";
import { googleConnector } from "@boringos/connector-google";
import { slackConnector } from "@boringos/connector-slack";

describe("AuthManager registry", () => {
  it("registers a connector and lists it", () => {
    const mgr = new AuthManager({} as any);
    mgr.registerConnector(googleConnector);
    expect(mgr.listConnectors()).toHaveLength(1);
    expect(mgr.getConnector("google")?.provider).toBe("google");
  });

  it("throws on duplicate registration", () => {
    const mgr = new AuthManager({} as any);
    mgr.registerConnector(googleConnector);
    expect(() => mgr.registerConnector(googleConnector)).toThrow(
      "Connector 'google' already registered",
    );
  });

  it("registers multiple connectors independently", () => {
    const mgr = new AuthManager({} as any);
    mgr.registerConnector(googleConnector);
    mgr.registerConnector(slackConnector);
    expect(mgr.listConnectors().map((c) => c.provider).sort()).toEqual(["google", "slack"]);
  });

  it("returns null for unknown provider", () => {
    const mgr = new AuthManager({} as any);
    expect(mgr.getConnector("nonexistent")).toBeNull();
  });
});
