// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T3.3 — connector types added to `@boringos/module-sdk` in #60
// flow through the package's public surface via `export * from
// "./types.js"`. This test locks that contract so a future refactor
// can't silently drop the re-export and force module authors to
// take a second SDK import for the connector slice.

import { describe, it, expectTypeOf } from "vitest";
import type {
  ConnectorDefinition,
  ConnectorTokenHandle,
  ConnectedAccount,
  ScopeCheckResult,
  ServiceDefinition,
  ScopeDefinition,
  AuthStrategy,
  OAuth2Strategy,
  BotTokenStrategy,
  PatStrategy,
  ApiKeyStrategy,
} from "@boringos/module-sdk";

describe("MDK T3.3 — connector types reachable from module-sdk", () => {
  it("the full Connector SDK v2 surface is re-exported", () => {
    // Pure compile-time existence check — any drop in the
    // re-export chain causes a `TS2305 Module ... has no exported
    // member ...` error and fails this test file at compile time.
    type Reachable =
      | ConnectorDefinition
      | ConnectorTokenHandle
      | ConnectedAccount
      | ScopeCheckResult
      | ServiceDefinition
      | ScopeDefinition
      | AuthStrategy
      | OAuth2Strategy
      | BotTokenStrategy
      | PatStrategy
      | ApiKeyStrategy;
    expectTypeOf<Reachable>().not.toBeNever();
  });

  it("AuthStrategy is the discriminated union of the four strategy shapes", () => {
    expectTypeOf<AuthStrategy>().toEqualTypeOf<
      OAuth2Strategy | ApiKeyStrategy | BotTokenStrategy | PatStrategy
    >();
  });

  it("ConnectorDefinition carries `requiredScopes` (T0.1 addition)", () => {
    // Constructs a ConnectorDefinition that uses requiredScopes.
    // If the field gets dropped or renamed, this fails to compile.
    const def: ConnectorDefinition = {
      provider: "demo",
      displayName: "Demo",
      auth: [
        {
          type: "oauth2",
          authorizationUrl: "https://example.invalid/authorize",
          tokenUrl: "https://example.invalid/token",
          clientIdEnv: "X",
          clientSecretEnv: "Y",
        },
      ],
      services: [],
      requiredScopes: [
        { scope: "openid", description: "OIDC", required: true },
      ],
      resolveAccountId: () => "acc-1",
    };
    expectTypeOf(def.requiredScopes).toMatchTypeOf<
      ScopeDefinition[] | undefined
    >();
  });

  it("ConnectorTokenHandle exposes a single `getToken` method", () => {
    expectTypeOf<ConnectorTokenHandle>().toEqualTypeOf<{
      getToken: () => Promise<string>;
    }>();
  });
});
