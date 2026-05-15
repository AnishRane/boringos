# License

BoringOS is licensed under the **GNU General Public License, version 3 or later** (`GPL-3.0-or-later`).

The full license text lives in [`LICENSE`](./LICENSE) at the repo root and applies to every package in this monorepo, including `packages/@boringos/shell`.

For background on the licensing model, see [`docs/licensing.md`](./docs/licensing.md).

---

## SPDX headers

Every source file starts with:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
```

CI fails any new file without the header and verifies the header matches each package's `package.json` `license` field.

---

*Last updated: 2026-05-16*
