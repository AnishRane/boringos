// SPDX-License-Identifier: MIT
//
// /module-sdk — public type surface for Modules.
//
// In this architecture, every component (connectors, apps, capabilities,
// built-in subsystems) is shaped as a `Module`. This package
// exports the types module authors implement. Runtime behaviour
// (registries, dispatch, prompt assembly) lives in
// @boringos/agent and @boringos/core.
//
// (see types.ts) until the phased
// migration in task_12 retires them.

export * from "./types.js";

// Convenience re-export so Module authors can write
//   import { z } from "@boringos/module-sdk";
// without taking a separate Zod dep. Zod is the canonical schema
// library for Tool inputs/outputs; the registry duck-types
// on `safeParse` so other libraries also work, but Zod is the
// blessed choice.
export { z } from "zod";
