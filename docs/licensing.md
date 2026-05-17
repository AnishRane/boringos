# Licensing

> BoringOS licensing in one page — what license applies, to what, and why.

**Audience:** Contributors, third-party developers, legal review.

---

## 1. The Licenses

BoringOS uses a **three-tier license layout**. One license for the
framework, one for the SDK that module authors import, one for the pure
type/utility package that anything in the ecosystem may depend on.

| Scope | SPDX | Applies to |
|---|---|---|
| Framework | `AGPL-3.0-or-later` | All packages under `packages/@boringos/` **except** the two below |
| Module SDK | `LGPL-3.0-or-later` | `packages/@boringos/module-sdk` |
| Shared types/utils | `Apache-2.0` | `packages/@boringos/shared` |

Full license texts:

- [`/LICENSE`](../LICENSE) — AGPL-3.0 (root of the repo, applies by default)
- [`/packages/@boringos/module-sdk/LICENSE`](../packages/@boringos/module-sdk/LICENSE) — LGPL-3.0
- [`/packages/@boringos/shared/LICENSE`](../packages/@boringos/shared/LICENSE) — Apache-2.0

---

## 2. Why This Split

The goal is to **protect the framework from being repackaged as a
proprietary or competing SaaS**, while keeping the door wide open for
agencies, integrators, customers running BoringOS internally, and
third-party module developers.

### Framework — AGPL-3.0-or-later

- **You can** read, audit, fork, modify, self-host, and ship the
  framework — commercially or not — including for clients.
- **You must**, if you offer a modified version as a network service,
  publish your modifications under AGPL-3.0 to the users of that
  service.
- **In practice this blocks** closed-source SaaS clones (the AWS /
  hyperscaler strip-mining pattern) without restricting honest use.

### Module SDK — LGPL-3.0-or-later

The **L** in LGPL is the **linking exception**. A module imports the
SDK without inheriting the SDK's license. Module authors stay in
control of their own licensing: a module can be Apache-2.0, MIT,
proprietary, AGPL, or anything else — it does not become LGPL or
AGPL just by importing `@boringos/module-sdk`.

If you fork and modify the SDK itself, those modifications stay
LGPL-3.0 and must be made available alongside binary distribution.

### Shared — Apache-2.0

Pure types and a small set of utilities, depended on by everything in
the ecosystem. Permissive so it never becomes a friction point. Modify
freely; preserve attribution.

---

## 3. What This Means For Common Cases

| You want to… | License terms |
|---|---|
| Run BoringOS inside your company | Free. No obligations as long as you don't modify it for redistribution. |
| Modify BoringOS for your own internal use | Free. No obligation to publish modifications (AGPL only triggers on distribution / network service). |
| Deploy BoringOS for a client as an integrator/SI | Free. You're not the "service provider" — your client is. Standard consulting model, like Linux. |
| Fork BoringOS, modify it, run it as a paid hosted service | Allowed, but you must publish your modifications under AGPL-3.0 to your users. |
| Ship a closed-source module on top of BoringOS | Allowed. Your module imports `@boringos/module-sdk` (LGPL) — the LGPL linking exception means your module stays in your control. |
| Vendor BoringOS into a closed-source product as a library | Not allowed under AGPL. The kernel itself is copyleft. (Talk to us about a commercial license if needed.) |

---

## 4. Contributions

Contributions are accepted under the **inbound = outbound** rule: by
submitting a pull request, you license your contribution under the
license of the package you're modifying (AGPL, LGPL, or Apache,
matching the file you touch).

A Contributor License Agreement (`CLA.md`) is required for first-time
contributors so the project can defend the license terms and, if ever
necessary, relicense or dual-license cleanly.

---

## 5. License Headers (SPDX)

Every source file declares its license in line 1:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later     // framework code
// SPDX-License-Identifier: LGPL-3.0-or-later     // packages/@boringos/module-sdk/**
// SPDX-License-Identifier: Apache-2.0            // packages/@boringos/shared/**
```

The identifier must match the package's `package.json` `license` field
and the `LICENSE` file that governs the directory.

---

## 6. License File Layout

```
repo-root/
  LICENSE              ← AGPL-3.0 full text — applies to the whole repo by default
  LICENSE.md           ← short index pointing at the three licenses
  docs/licensing.md    ← this file (rationale)
  packages/
    @boringos/
      module-sdk/
        LICENSE        ← LGPL-3.0 full text
        package.json   ← "license": "LGPL-3.0-or-later"
      shared/
        LICENSE        ← Apache-2.0 full text
        package.json   ← "license": "Apache-2.0"
      core/
        package.json   ← "license": "AGPL-3.0-or-later"   (inherits root LICENSE)
      ...
```

Every other package inherits the root `LICENSE` and declares
`"license": "AGPL-3.0-or-later"` in its `package.json`.

---

## 7. Third-Party Code in Our Repos

When we vendor or fork third-party code:

- The code's original license stays in place.
- A `THIRD_PARTY_NOTICES.md` file at the repo root lists every
  dependency and its license.
- We only ingest code under licenses compatible with the destination
  package's license: AGPL-compatible for framework code (e.g. MIT,
  BSD, Apache 2.0, LGPL, AGPL, GPL itself), Apache-2.0-compatible for
  `shared`.

---

## 8. Marketplace Submission Licensing

Apps and connectors submitted to the BoringOS marketplace declare a
license in their manifest:

```json
{ "license": "AGPL-3.0-or-later" }
{ "license": "Apache-2.0" }
{ "license": "MIT" }
{ "license": "Proprietary" }
```

The `license` field is shown on the marketplace listing. Module
authors are free to license their own modules however they wish — the
framework's AGPL governs only the framework's own code.

---

## 9. Reading Order From Here

- [Overview](./overview.md) — the architecture this licensing model maps to
- [Publishing & Install](./developer/publishing-and-install.md) — marketplace policies enforce licensing declarations

---

*Last updated: 2026-05-17*
