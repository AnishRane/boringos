// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generate a minimum-viable Hebbs module on disk. Today (T5.1) the
// emitted module ships ONE tool + ONE skill — enough that
// `hebbs test` can boot it green. T5.2 extends this with the full
// "one-of-each" template (UI, widget, seeded agent / workflow /
// routine, demo schema).

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;

export interface ScaffoldOptions {
  /** Module id — must be `^[a-z][a-z0-9-]*$`. Becomes `<id>`
   *  everywhere in the generated files. */
  id: string;
  /** Directory the module is emitted into. Created if missing.
   *  Must not already contain a `module.json` (the scaffolder
   *  refuses to overwrite an existing module). */
  targetDir: string;
  /** Human-readable name for `module.json.name`. Defaults to the
   *  id with the first character capitalized. */
  displayName?: string;
  /** One-line description for `module.json.description`. */
  description?: string;
  /** Minimum framework version the module declares. Defaults to
   *  the current published `@boringos/module-sdk`-compatible
   *  baseline. */
  minFrameworkVersion?: string;
}

export interface ScaffoldResult {
  /** Absolute path of the scaffolded module dir. */
  targetDir: string;
  /** Module id baked into the templates. */
  id: string;
  /** Files written, relative to `targetDir`. */
  files: string[];
}

const DEFAULT_MIN_FRAMEWORK = "0.1.0";

/**
 * Scaffold a Hebbs module on disk.
 *
 * Throws on:
 *  - invalid id (must be `[a-z][a-z0-9-]*`)
 *  - target dir already contains a `module.json`
 */
export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  if (!MODULE_ID_RE.test(opts.id)) {
    throw new Error(
      `create-hebbs-module: invalid id "${opts.id}". Must match /^[a-z][a-z0-9-]*$/.`,
    );
  }
  const targetDir = resolve(opts.targetDir);
  if (existsSync(join(targetDir, "module.json"))) {
    throw new Error(
      `create-hebbs-module: refusing to overwrite — ${targetDir} already contains a module.json.`,
    );
  }

  const displayName =
    opts.displayName ?? opts.id.charAt(0).toUpperCase() + opts.id.slice(1);
  const description =
    opts.description ??
    `${displayName} — scaffolded by create-hebbs-module.`;
  const minFrameworkVersion =
    opts.minFrameworkVersion ?? DEFAULT_MIN_FRAMEWORK;

  await mkdir(targetDir, { recursive: true });
  await mkdir(join(targetDir, "src"), { recursive: true });

  const files: string[] = [];

  // ── module.json ───────────────────────────────────────────
  await writeFile(
    join(targetDir, "module.json"),
    JSON.stringify(
      {
        id: opts.id,
        version: "0.1.0",
        kind: "module",
        name: displayName,
        description,
        entry: "./index.mjs",
        minFrameworkVersion,
        publisher: { id: "your-publisher-id", name: "Your Publisher" },
        license: "MIT",
      },
      null,
      2,
    ) + "\n",
  );
  files.push("module.json");

  // ── package.json ──────────────────────────────────────────
  await writeFile(
    join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: opts.id,
        version: "0.1.0",
        private: true,
        type: "module",
        main: "./dist/index.js",
        scripts: {
          build: "tsc",
          test: "hebbs test .",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          "@boringos/module-sdk": "^0.10.0",
        },
        devDependencies: {
          "@boringos/hebbs-cli": "^0.1.0",
          "@types/node": "^22.0.0",
          typescript: "^5.7.3",
        },
      },
      null,
      2,
    ) + "\n",
  );
  files.push("package.json");

  // ── tsconfig.json ─────────────────────────────────────────
  await writeFile(
    join(targetDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          declaration: true,
          outDir: "dist",
          rootDir: "src",
        },
        include: ["src"],
      },
      null,
      2,
    ) + "\n",
  );
  files.push("tsconfig.json");

  // ── src/module.ts ─────────────────────────────────────────
  await writeFile(
    join(targetDir, "src", "module.ts"),
    [
      `// ${displayName} — scaffolded by create-hebbs-module.`,
      ``,
      `import { z } from "@boringos/module-sdk";`,
      `import type { Module, ModuleFactory } from "@boringos/module-sdk";`,
      ``,
      `export const create${pascal(opts.id)}Module: ModuleFactory = () => {`,
      `  const module: Module = {`,
      `    id: "${opts.id}",`,
      `    name: "${displayName}",`,
      `    version: "0.1.0",`,
      `    description: ${JSON.stringify(description)},`,
      `    skills: [`,
      `      {`,
      `        id: "${opts.id}",`,
      `        source: "module",`,
      `        body: "Use \\\`${opts.id}.greet\\\` to greet someone by name.",`,
      `      },`,
      `    ],`,
      `    tools: [`,
      `      {`,
      `        name: "greet",`,
      `        description: "Greet someone by name",`,
      `        inputs: z.object({ name: z.string() }),`,
      `        async handler({ name }: { name: string }) {`,
      `          return {`,
      `            ok: true as const,`,
      `            result: { greeting: \`Hello, \${name}!\` },`,
      `          };`,
      `        },`,
      `      },`,
      `    ],`,
      `  };`,
      `  return module;`,
      `};`,
      ``,
      `export default create${pascal(opts.id)}Module;`,
      ``,
    ].join("\n"),
  );
  files.push("src/module.ts");

  // ── src/index.ts ──────────────────────────────────────────
  await writeFile(
    join(targetDir, "src", "index.ts"),
    `export { create${pascal(opts.id)}Module, default } from "./module.js";\n`,
  );
  files.push("src/index.ts");

  // ── README.md ────────────────────────────────────────────
  await writeFile(
    join(targetDir, "README.md"),
    [
      `# ${displayName}`,
      ``,
      `${description}`,
      ``,
      `## Develop`,
      ``,
      "```bash",
      `pnpm install`,
      `pnpm build`,
      `pnpm test    # boots a headless host and dispatches ${opts.id}.greet`,
      "```",
      ``,
      `## Pack a \`.hebbsmod\``,
      ``,
      "```bash",
      `npx -p @boringos/module-sdk pack-hebbsmod --pkg .`,
      "```",
      ``,
      "Drop the resulting `dist/<id>-<version>.hebbsmod` onto a deployed Hebbs Shell → Settings → Modules → Upload.",
      ``,
    ].join("\n"),
  );
  files.push("README.md");

  // ── .gitignore ───────────────────────────────────────────
  await writeFile(
    join(targetDir, ".gitignore"),
    ["node_modules/", "dist/", ".data/", ""].join("\n"),
  );
  files.push(".gitignore");

  return { targetDir, id: opts.id, files };
}

function pascal(id: string): string {
  return id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
