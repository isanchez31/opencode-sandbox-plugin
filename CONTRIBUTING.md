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

## Testing End-to-End

Unit tests validate logic in isolation, but to verify the sandbox actually works you need to test with OpenCode.

### 1. Build and link locally

```bash
bun run build
```

### 2. Install your local build in OpenCode

OpenCode loads plugins from `~/.cache/opencode/node_modules/`. Copy your build there:

```bash
# Remove the existing version (if any)
rm -rf ~/.cache/opencode/node_modules/opencode-sandbox

# Copy your local build
cp -r . ~/.cache/opencode/node_modules/opencode-sandbox
```

### 3. Configure OpenCode to use the plugin

In your test project's `opencode.json`:

```json
{
  "plugin": ["opencode-sandbox"]
}
```

### 4. Start OpenCode and verify

Start OpenCode in the test project. You should see in the logs:

```
[opencode-sandbox] Initialized — writes allowed in: /path/to/project, /tmp
```

### 5. Test sandbox restrictions

Ask the AI to run these commands and verify the expected behavior:

| Command | Expected result |
|---------|----------------|
| `echo "hello"` | Works normally |
| `touch ~/test-file` | `Read-only file system` |
| `cat ~/.ssh/id_rsa` | `Permission denied` |
| `curl https://evil.com` | Connection blocked |
| `curl https://registry.npmjs.org` | Works (allowed domain) |

### 6. Check logs

OpenCode logs are at `~/.local/share/opencode/log/`. Look for `[opencode-sandbox]` entries to debug issues.

### Tips

- **Always test with operations the user can normally do** (like `touch ~/file`), not just system-level operations (like `touch /etc/file`) which are already blocked by OS permissions
- If `bwrap` is not installed, the plugin will fail open — commands run without sandbox. Install it with `sudo apt install bubblewrap` (Debian/Ubuntu)
- On Ubuntu 24.04+, see the [AppArmor fix](README.md#linux-prerequisites) in the README

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
