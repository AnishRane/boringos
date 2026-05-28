// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T3.1d — minimal `ToolRegistry` contract for `ModuleFactoryDeps`.
//
// The full registry (registration + per-capability listing +
// uninstall) lives in `@boringos/agent`. Modules and HTTP routes
// only need to LOOK UP tools — `get`, `list`, `listByModule`. This
// narrow interface keeps module-sdk cycle-free from `@boringos/
// agent`; the agent's concrete `ToolRegistry` structurally implements
// the SDK surface and adds the host-side write methods.

import type { Tool } from "./types.js";

/**
 * A Tool plus its owning Module's id. Returned from registry
 * lookups so callers can inspect both pieces.
 */
export interface RegisteredTool {
  moduleId: string;
  fullName: string;
  tool: Tool;
}

/**
 * Read-only view of the host's tool registry. Tools are addressed
 * by fully-qualified `<module-id>.<tool-name>`.
 */
export interface ToolRegistry {
  /** Resolve a tool by its fully-qualified name. */
  get(fullName: string): Tool | undefined;
  /** Every registered tool, in registration order. */
  list(): readonly RegisteredTool[];
  /** Tools registered by a specific module. */
  listByModule(moduleId: string): readonly RegisteredTool[];
}
