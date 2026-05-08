// SPDX-License-Identifier: MIT
//
// v2 module registry — knows which Modules the host has
// registered, walks their tools + skills + routines into the
// per-domain registries, and exposes capability resolution.
//
// Phase 1 contract:
//  - `register` records a Module and forwards its tools/skills
//    into the supplied registries.
//  - `get` / `list` for lookup.
//  - `byCapability` answers capability resolution queries.
//  - `unregister` removes everything the Module pushed.
//
// Per-tenant install state (which Modules are turned on for which
// tenant) lives in the DB, not here. This registry is the
// host-process catalog of Modules the host application has
// imported.

import type { Module } from "@boringos/module-sdk";
import type { ToolRegistry } from "./tool-registry.js";
import type { SkillRegistry } from "./skill-registry.js";

export interface ModuleRegistry {
  register(mod: Module): void;
  get(id: string): Module | undefined;
  list(): readonly Module[];
  byCapability(capability: string): readonly Module[];
  unregister(id: string): void;
}

export interface ModuleRegistryDeps {
  tools: ToolRegistry;
  skills: SkillRegistry;
}

export function createModuleRegistry(deps: ModuleRegistryDeps): ModuleRegistry {
  const modules = new Map<string, Module>();

  return {
    register(mod) {
      if (modules.has(mod.id)) {
        throw new Error(
          `Module "${mod.id}" already registered. Module ids must ` +
            "be unique within a host process.",
        );
      }
      modules.set(mod.id, mod);

      for (const tool of mod.tools ?? []) {
        deps.tools.register(mod.id, tool);
      }

      for (const skillRef of mod.skills ?? []) {
        // Phase 1 only handles the inline `Skill` form. Path
        // strings (loading SKILL.md from disk) are added in
        // Phase 3 along with the `skills` context provider.
        if (typeof skillRef === "string") {
          // Eventually: read the file, parse frontmatter, build a
          // Skill record. For now: no-op; the test suite uses
          // inline form.
          continue;
        }
        deps.skills.register(mod.id, skillRef);
      }
    },

    get(id) {
      return modules.get(id);
    },

    list() {
      return Array.from(modules.values());
    },

    byCapability(capability) {
      return Array.from(modules.values()).filter((mod) =>
        (mod.provides ?? []).includes(capability),
      );
    },

    unregister(id) {
      const mod = modules.get(id);
      if (!mod) return;
      deps.tools.unregisterModule(id);
      deps.skills.unregisterModule(id);
      modules.delete(id);
    },
  };
}
