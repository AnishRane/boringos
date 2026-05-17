# Contributing to BoringOS

  We welcome contributions! Here's how to get started.

  ## Reporting issues & requesting features

  Before opening a PR, please file an issue using one of our templates so we can scope the change together. Each template is a structured form on GitHub:

  - 🐛 **[Bug report](https://github.com/BoringOS-dev/boringos/issues/new?template=bug_report.yml)** — something isn't working as expected. Include reproduction steps, BoringOS version, Node version (≥22), and the agent runtime you're using (claude / chatgpt / gemini / ollama / command / webhook).
  - 🚀 **[Feature request](https://github.com/BoringOS-dev/boringos/issues/new?template=feature_request.yml)** — propose a new capability. Call out which primitive it touches: **Skill**, **Tool**, **Module**, runtime, queue, or persona.
  - 📚 **[Docs feedback](https://github.com/BoringOS-dev/boringos/issues/new?template=docs_feedback.yml)** — unclear, missing, broken, or outdated docs. Point to the file (`CLAUDE.md`, `BUILD-A-MODULE.md`, `docs/…`) or URL.

  Please [search existing issues](https://github.com/BoringOS-dev/boringos/issues) before filing — duplicates slow everyone down. If you're unsure whether something is a bug or intended behavior, the bug template is the right starting point.

  For larger changes (new Module, new runtime, schema changes), open a feature request first so we can align on the approach before you write code.

  ## CLA Requirement

  All contributors must agree to our [Contributor License Agreement](CLA.md) before any PR is merged. The CLA gives BoringOS-dev the right to use your contribution and (where necessary) relicense it as the project evolves, while you retain copyright in your work.

  **By opening a pull request to this repository, you affirm that you have read [`CLA.md`](CLA.md) and agree to its terms for your contribution and any future contribution you make to this project.** The pull request template includes an explicit checkbox to confirm this — please tick it before requesting review.

  Once installed, a CLA bot will additionally record your acceptance against your GitHub account so you only need to confirm once across all BoringOS-dev repositories. Until the bot is in place, the checkbox on each PR serves as your record of acceptance.

  ## Getting Started

  ```bash
  git clone https://github.com/BoringOS-dev/boringos.git
  cd boringos
  pnpm install
  pnpm -r build
  pnpm test:run

  Development Workflow

  1. Open (or pick up) a bug, feature, or docs issue
  2. Fork the repo and create a branch from main
  3. Make your changes
  4. Run pnpm -r build, pnpm -r typecheck, and pnpm test:run to verify
  5. Submit a pull request — the PR template will walk you through what to include. Link the issue with Closes #123.

  What We're Looking For

  - Bug fixes with tests
  - New connector implementations (see @boringos/connector-slack as reference)
  - New runtime adapters
  - Documentation improvements
  - Performance improvements with benchmarks

  Code Style

  - TypeScript strict mode
  - ES2022 target, NodeNext modules
  - No external formatters — just follow existing patterns
  - Tests in tests/ using Vitest

  Questions?

  Pick the right entry point:

  - Something broken? → Bug report
  - Idea or proposal? → Feature request
  - Docs unclear, missing, or wrong? → Docs feedback
  - Open-ended question? → start a discussion on GitHub.

  Resolution: kept the upper block (your new "Reporting issues" and "CLA Requirement" sections) and dropped the conflict markers — the lower side just lacked those sections, so nothing was lost from `origin/main`.
