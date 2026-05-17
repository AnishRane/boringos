# License

BoringOS uses a three-tier license layout so the framework stays strongly
copyleft (no closed-source clones, no SaaS strip-mining) while module
authors keep full freedom over their own code.

| Scope | License | Why |
|---|---|---|
| Framework — everything under `packages/@boringos/` **except** `module-sdk` and `shared` | **AGPL-3.0-or-later** | Strong network copyleft. Anyone running a modified version as a service must publish their changes. |
| `packages/@boringos/module-sdk` | **LGPL-3.0-or-later** | Linking exception — modules can import the SDK without inheriting copyleft. |
| `packages/@boringos/shared` | **Apache-2.0** | Pure types/utilities. Permissive so any consumer can depend on them. |

Repo root [`LICENSE`](./LICENSE) holds the AGPL text. The two carved-out
packages ship their own [`LICENSE`](./packages/@boringos/module-sdk/LICENSE)
file alongside their `package.json`.

For the longer rationale, contributor terms, and SPDX policy, see
[`docs/licensing.md`](./docs/licensing.md).

---

## SPDX headers

Every source file declares its license inline:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later     // framework code
// SPDX-License-Identifier: LGPL-3.0-or-later     // module-sdk
// SPDX-License-Identifier: Apache-2.0            // shared
```

The identifier must match the package's `package.json` `license` field and
the `LICENSE` file that applies to that package.

---

*Last updated: 2026-05-17*
