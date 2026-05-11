# tests/fixtures

`.hebbsmod` artifacts used by the U2/U3 test suites (`module_packages`
runtime register + HTTP upload path). Committed for test stability —
regenerate only when the source module changes.

## Contents

| File | Module | Notes |
|---|---|---|
| `crm-0.2.0.hebbsmod` | `@boringos-crm/server` | Hybrid module (owns its own schema). Bundle includes `module.json`, `index.mjs`, and the seven CRM SKILL.md files. No `migrations/` dir (CRM emits its DDL via `crmMigrations` inlined in the bundle). No `ui/` (CRM's UI lives in the sibling `boringos-crm/packages/web` package and is not yet packed — U4 will tackle UI bundling). |

## Regenerate

```bash
cd /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework
pnpm pack:modules
cp ../boringos-crm/packages/server/dist/crm-*.hebbsmod tests/fixtures/
```

If `pnpm pack:modules` reports `fail crm — expected artifact not found`,
the `pack-hebbsmod` shell wrapper is silently no-opping (see "Known
wrapper bug" below). Workaround until U1.3 is patched:

```bash
node packages/@boringos/module-sdk/dist/cli/pack-hebbsmod.js \
  --pkg /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-crm/packages/server
# then re-run `pnpm pack:modules` — it will see the artifact and report ok.
```

## Known wrapper bug

`node_modules/.bin/pack-hebbsmod` (the npm-style shell wrapper around
`pack-hebbsmod.js`) exits 0 silently without producing an artifact when
invoked under pnpm's symlinked layout.

Root cause: the `invokedDirectly` guard in `pack-hebbsmod.js` compares
`resolvePath(process.argv[1])` (which Node leaves as the symlinked path
`node_modules/@boringos/module-sdk/dist/cli/pack-hebbsmod.js`) against
`resolvePath(fileURLToPath(import.meta.url))` (which Node has already
realpath-resolved to `packages/@boringos/module-sdk/dist/cli/...`).
The paths differ, the guard fails, `main()` never runs, the process
exits 0. Fix is a one-liner — compare via `realpathSync` on both sides.

## Authoritative `module.json`

The CRM module manifest source of truth is
`boringos-crm/packages/server/module.json`. The packed copy inside the
archive must match. If they drift, the manifest validation step in
`install-manager` will reject the upload.
