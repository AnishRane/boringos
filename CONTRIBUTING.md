# Contributing to BoringOS

We welcome contributions! Here's how to get started.

## Getting Started

```bash
git clone https://github.com/BoringOS-dev/boringos.git
cd boringos
pnpm install
pnpm -r build
pnpm test:run
```

## Development Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm -r typecheck` and `pnpm test:run` to verify
4. Submit a pull request

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

Open an issue or start a discussion on GitHub.
