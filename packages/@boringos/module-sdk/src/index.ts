// SPDX-License-Identifier: MIT
//
// @boringos/module-sdk — public type surface for v2 Modules.
//
// In v2, every component (connectors, apps, capabilities,
// built-in subsystems) is shaped as a `Module`. This package
// exports the types module authors implement. Runtime behaviour
// (registries, dispatch, prompt assembly) lives in
// @boringos/agent and @boringos/core.
//
// Greenfield additive — coexists with v1 types until the phased
// migration in task_12 retires them.

export * from "./types.js";
