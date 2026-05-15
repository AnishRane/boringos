# Licensing

> BoringOS licensing in one page — what license applies, to what, and why.

**Audience:** Contributors, third-party developers, legal review.

---

## 1. The License

BoringOS is licensed under the **GNU General Public License, version 3 or later** (`GPL-3.0-or-later`).

This applies to every package in the monorepo — kernel, SDKs, connectors, and shell alike. There is no per-package matrix; the repo is single-license.

Full text: [`LICENSE`](../LICENSE) at the repo root.

---

## 2. What GPLv3 Means For You

GPLv3 is a strong copyleft license. In short:

- **You can** read, audit, modify, redistribute, and use the code — including in production, commercially.
- **You must** make your modifications available under GPLv3 when you distribute derivative works, and you must preserve copyright and license notices.
- **Combined works** that link against GPL code are themselves subject to GPL terms when distributed.

For the canonical, legally binding terms, read the [LICENSE](../LICENSE) file. The GNU project's own [GPLv3 FAQ](https://www.gnu.org/licenses/gpl-faq.html) is a good companion resource.

---

## 3. Contributions

Contributions are accepted under the inbound = outbound rule: by submitting a pull request, you license your contribution under `GPL-3.0-or-later`.

We do not require a separate CLA. Contributors retain their copyright.

---

## 4. License Headers

Every source file in this repo starts with an SPDX header:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
```

A lint rule fails any new file without a header. CI also verifies that the header matches the package's `package.json` `license` field and the repo's `LICENSE` file.

---

## 5. License File Layout

```
repo-root/
  LICENSE              ← GPLv3 full text — applies to the whole repo
  LICENSE.md           ← short index pointing at LICENSE and this doc
  packages/
    @boringos/shell/
      LICENSE          ← GPLv3 full text (copy of root LICENSE, kept for package consumers)
      package.json     ← "license": "GPL-3.0-or-later"
```

Other packages inherit from the root `LICENSE`; they declare `"license": "GPL-3.0-or-later"` in their `package.json`.

---

## 6. Third-Party Code in Our Repos

When we vendor or fork third-party code:

- The code's original license stays in place.
- A `THIRD_PARTY_NOTICES.md` file at the repo root lists every dependency and its license.
- We only ingest code under GPL-compatible licenses (e.g. MIT, BSD, Apache 2.0, LGPL, GPL itself). We do not ingest code under licenses incompatible with GPLv3.

This is enforced by a license-scan job on every CI run.

---

## 7. Marketplace Submission Licensing

Apps and connectors submitted to the BoringOS marketplace must declare a license in their manifest:

```json
{ "license": "GPL-3.0-or-later" }
{ "license": "MIT" }
{ "license": "Apache-2.0" }
{ "license": "Proprietary" }
```

The `license` field is shown on the marketplace listing so tenants can decide how the licensing affects their use. Authors are free to license their own modules however they wish; the GPL terms of BoringOS itself govern only the framework and its built-in packages.

---

## 8. Reading Order From Here

- [Overview](./overview.md) — the architecture this licensing model maps to
- [Publishing & Install](./developer/publishing-and-install.md) — marketplace policies enforce licensing declarations

---

*Last updated: 2026-05-16*
