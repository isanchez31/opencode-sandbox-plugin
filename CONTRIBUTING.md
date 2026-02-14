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
bun run build    # Build the project
bun test         # Run tests
bun run dev      # Watch mode
```

## Making Changes

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. Make your changes and add tests if applicable.

3. Ensure all tests pass:
   ```bash
   bun test
   ```

4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add new sandbox restriction
   fix: handle edge case in config loading
   docs: update README examples
   test: add tests for network config
   chore: update dependencies
   ```

5. Open a Pull Request against `main`.

## Code Style

- TypeScript with strict mode
- Use `bun` as the package manager and test runner
- Keep dependencies minimal
- Prefer explicit error handling over silent failures

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

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
