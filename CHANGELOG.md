# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.22](https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.21...v0.1.22) (2026-02-26)


### Fixed

* use Map keyed by callID to prevent race condition in command restoration ([#11](https://github.com/isanchez31/opencode-sandbox-plugin/issues/11)) ([faadd47](https://github.com/isanchez31/opencode-sandbox-plugin/commit/faadd479beda92606c2212e874c109406bb2e091))

## [0.1.21](https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.20...v0.1.21) (2026-02-14)


### Documentation

* add end-to-end testing guide to CONTRIBUTING.md ([2abbe00](https://github.com/isanchez31/opencode-sandbox-plugin/commit/2abbe00c14bd6aca75d26739ba6fd330d8c28882))

## [0.1.20](https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.19...v0.1.20) (2026-02-14)


### Documentation

* add SECURITY.md and update CONTRIBUTING.md with quality tooling ([b3b9fe7](https://github.com/isanchez31/opencode-sandbox-plugin/commit/b3b9fe72a2cc2718ca194d06354d29b1981bf0b0))

## [0.1.19](https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.18...v0.1.19) (2026-02-14)


### Documentation

* make docs commits visible in release changelog ([9eff69f](https://github.com/isanchez31/opencode-sandbox-plugin/commit/9eff69fcb12120ab8d190aa643d4b3f164951207))
* replace local development and architecture sections with CONTRIBUTING.md link ([d65d452](https://github.com/isanchez31/opencode-sandbox-plugin/commit/d65d452cee9056766d8f10b513fcada3c878747b))

## [0.1.18](https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.17...v0.1.18) (2026-02-14)


### Fixed

* **ci:** use plain version tags for release-please ([d0ea18e](https://github.com/isanchez31/opencode-sandbox-plugin/commit/d0ea18e56799371b594e9417339db2e6438800d1))
* reset version for clean release-please cycle ([56cf9b3](https://github.com/isanchez31/opencode-sandbox-plugin/commit/56cf9b34b7834a4714d33f1a45877cdf65092970))

## [0.1.17] - 2026-02-14

### Added

- Biome for linting and formatting with project conventions
- CHANGELOG.md covering all releases
- README badges (CI, npm version, license)
- Dependabot for npm and GitHub Actions dependencies
- `test:coverage` script using bun's built-in coverage

### Changed

- Split CI into parallel `quality` and `test` jobs
- Normalize code style with Biome (`node:` import protocol, literal keys, import ordering)

## [0.1.16] - 2026-02-14

### Changed

- Updated README with AppArmor fix, sandbox examples, and architecture section

## [0.1.15] - 2026-02-14

### Security

- Reject unsafe broad write paths like `/` from worktree to prevent sandbox bypass

## [0.1.14] - 2026-02-14

### Changed

- Remove block detection heuristics — AI now interprets sandbox errors directly from raw output

## [0.1.13] - 2026-02-14

### Added

- CI workflow for automated testing and build
- Automated npm publish workflow with OIDC Trusted Publishing
- Contribution guidelines, code of conduct, and issue/PR templates

### Fixed

- Simplified publish workflow for OIDC compatibility

## [0.1.4] - 2026-02-14

### Added

- Clean UI display for sandboxed commands

## [0.1.3] - 2026-02-14

### Added

- Show clean annotation in UI while keeping full output for AI

## [0.1.2] - 2026-02-14

### Fixed

- Mutate `metadata.output` so TUI displays annotation correctly

## [0.1.1] - 2026-02-14

### Fixed

- Normalize repository URL to `git+` protocol
- Add package metadata and fix LICENSE copyright

## [0.1.0] - 2026-02-14

### Added

- Initial release
- Sandbox plugin with command wrapping hooks (`tool.execute.before` / `tool.execute.after`)
- Config resolution from environment variable, `.opencode/sandbox.json`, or defaults
- Filesystem restrictions: deny-read for sensitive dirs, allow-write for project + `/tmp`
- Network allowlist with proxy-based domain filtering
- Unit tests for config and plugin hooks

[0.1.17]: https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.4...v0.1.13
[0.1.4]: https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/isanchez31/opencode-sandbox-plugin/releases/tag/v0.1.0
