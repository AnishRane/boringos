# Contributing to BoringOS

We welcome contributions! Here's how to get started.

## Reporting issues & requesting features

Before opening a PR, please file an issue using one of our templates so we can scope the change together. Each template is a structured form on GitHub:

- 🐛 **[Bug report](https://github.com/AnishRane/boringos/issues/new?template=bug_report.yml)** — something isn't working as expected. Include reproduction steps, BoringOS version, Node version (≥22), and the agent runtime you're using (claude / chatgpt / gemini / ollama / command / webhook).
- 🚀 **[Feature request](https://github.com/AnishRane/boringos/issues/new?template=feature_request.yml)** — propose a new capability. Call out which primitive it touches: **Skill**, **Tool**, **Module**, runtime, queue, or persona.
- 📚 **[Docs feedback](https://github.com/AnishRane/boringos/issues/new?template=docs_feedback.yml)** — unclear, missing, broken, or outdated docs. Point to the file (`CLAUDE.md`, `BUILD-A-MODULE.md`, `docs/…`) or URL.

Please [search existing issues](https://github.com/AnishRane/boringos/issues) before filing — duplicates slow everyone down. If you're unsure whether something is a bug or intended behavior, the bug template is the right starting point.

For larger changes (new Module, new runtime, schema changes), open a feature request first so we can align on the approach before you write code.

## CLA Requirement

All contributors must sign our [Contributor License Agreement](CLA.md) before their first PR can be merged. This is a one-time process handled automatically:

1. Open a pull request
2. The CLA bot will comment if you haven't signed yet
3. Reply with: **I have read the CLA Document and I hereby sign the CLA**
4. All future contributions are covered — no need to sign again

The CLA ensures we can maintain and evolve BoringOS (including potential relicensing) while protecting both the project and contributors.

## Getting Started

```bash
git clone https://github.com/BoringOS-dev/boringos.git
cd boringos
pnpm install
pnpm -r build
pnpm test:run
```

## Development Workflow

1. Open (or pick up) a [bug](https://github.com/AnishRane/boringos/issues/new?template=bug_report.yml), [feature](https://github.com/AnishRane/boringos/issues/new?template=feature_request.yml), or [docs](https://github.com/AnishRane/boringos/issues/new?template=docs_feedback.yml) issue
2. Fork the repo and create a branch from `main`
3. Make your changes
4. Run `pnpm -r build`, `pnpm -r typecheck`, and `pnpm test:run` to verify
5. Submit a pull request — the [PR template](.github/PULL_REQUEST_TEMPLATE.md) will walk you through what to include. Link the issue with `Closes #123`.

## What We're Looking For

- Bug fixes with tests
- New connector implementations (see `@boringos/connector-slack` as reference)
- New runtime adapters
- Documentation improvements
- Performance improvements with benchmarks

## Code Style

- TypeScript strict mode
- ES2022 target, NodeNext modules
- No external formatters — just follow existing patterns
- Tests in `tests/` using Vitest

## Questions?

Pick the right entry point:

- Something broken? → [Bug report](https://github.com/AnishRane/boringos/issues/new?template=bug_report.yml)
- Idea or proposal? → [Feature request](https://github.com/AnishRane/boringos/issues/new?template=feature_request.yml)
- Docs unclear, missing, or wrong? → [Docs feedback](https://github.com/AnishRane/boringos/issues/new?template=docs_feedback.yml)
- Open-ended question? → start a [discussion](https://github.com/AnishRane/boringos/discussions) on GitHub.
