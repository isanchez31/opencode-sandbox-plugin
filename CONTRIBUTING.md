# Contributing to opencode-sandbox

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/isanchez31/opencode-sandbox-plugin.git
cd opencode-sandbox-plugin
bun install
```

## Commands

```bash
bun run build        # Build the project
bun test             # Run tests
bun test --coverage  # Run tests with coverage
bun run check        # Lint + format check (Biome)
bun run check:fix    # Lint + format auto-fix
bun run typecheck    # Type check (tsc --noEmit)
bun run dev          # Watch mode
```

## Making Changes

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. Make your changes and add tests if applicable.

3. Ensure everything passes before committing:
   ```bash
   bun run check      # Lint + format
   bun run typecheck   # Type check
   bun test            # Tests
   ```

4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add new sandbox restriction
   fix: handle edge case in config loading
   docs: update README examples
   test: add tests for network config
   chore: update dependencies
   ```

5. Open a Pull Request against `main`. PR titles must follow the same conventional commit format.

## Code Quality

This project uses the following tools to maintain code quality:

- **[Biome](https://biomejs.dev/)** for linting and formatting (replaces ESLint + Prettier)
- **TypeScript strict mode** for type safety
- **tsc --noEmit** for type checking beyond what Biome covers
- **bun test** with built-in coverage for testing

All checks run automatically in CI. PRs must pass the `quality` and `test` jobs before merging.

## Project Structure

```
src/
├── index.ts    # Plugin entry point and hooks
└── config.ts   # Config loading, defaults, and resolution

test/
├── config.test.ts   # Config unit tests
└── plugin.test.ts   # Plugin integration tests
```

## Reporting Bugs

Use the [bug report template](https://github.com/isanchez31/opencode-sandbox-plugin/issues/new?template=bug_report.md) and include:

- Your OS and version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs

## Requesting Features

Use the [feature request template](https://github.com/isanchez31/opencode-sandbox-plugin/issues/new?template=feature_request.md).

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
