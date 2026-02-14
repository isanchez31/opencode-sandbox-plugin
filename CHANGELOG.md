# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.18...v0.2.0) (2026-02-14)


### Added

* add sandbox config resolution and loading ([c00b5c1](https://github.com/isanchez31/opencode-sandbox-plugin/commit/c00b5c16221eb67186db15ffac1069fa6bed2181))
* add sandbox plugin with command wrapping hooks ([92c1a91](https://github.com/isanchez31/opencode-sandbox-plugin/commit/92c1a91069390b1fd789c47e639da9cf7e345d81))
* clean UI display for sandboxed commands ([3fbf9a8](https://github.com/isanchez31/opencode-sandbox-plugin/commit/3fbf9a80f75fe26995e9988df8b6fec3d6b56db7))
* show clean annotation in UI, keep full output for AI ([1aef5f7](https://github.com/isanchez31/opencode-sandbox-plugin/commit/1aef5f7fe958d6fa0844a43bdf7ab071850aadb7))


### Fixed

* also mutate metadata.output so TUI displays annotation ([278a10f](https://github.com/isanchez31/opencode-sandbox-plugin/commit/278a10f32fa059bce8c9c6ff6987b37d3e5ae666))
* **ci:** configure OIDC trusted publishing correctly ([028f5bf](https://github.com/isanchez31/opencode-sandbox-plugin/commit/028f5bf53f80946bc08c7818a40f75a42b1d3637))
* **ci:** remove registry-url completely, add OIDC debug logging ([3475fc3](https://github.com/isanchez31/opencode-sandbox-plugin/commit/3475fc3abc8eb0a9ca81f1121c4dd33d8d4464f0))
* **ci:** remove registry-url to enable OIDC auth, bump to v0.1.10 ([1da1749](https://github.com/isanchez31/opencode-sandbox-plugin/commit/1da1749465eed3e570fe1646f6565476a5e93e6e))
* **ci:** simplify publish workflow for OIDC compatibility ([5a8069d](https://github.com/isanchez31/opencode-sandbox-plugin/commit/5a8069dfd870971d66cabb1a1be6165571eee536))
* **ci:** use plain version tags for release-please ([d0ea18e](https://github.com/isanchez31/opencode-sandbox-plugin/commit/d0ea18e56799371b594e9417339db2e6438800d1))
* clean bwrap noise from AI output and detect silent blocks ([00e2def](https://github.com/isanchez31/opencode-sandbox-plugin/commit/00e2def30671f0fae60199479a6573e633b92528))
* ignore benign bwrap loopback warning in block detection ([b6da68e](https://github.com/isanchez31/opencode-sandbox-plugin/commit/b6da68eba70f608c6652dac79fe9744bd764d5e6))
* normalize repository URL to git+ protocol ([9215f79](https://github.com/isanchez31/opencode-sandbox-plugin/commit/9215f7985ba74d466386040364c30a66584db903))
* only show annotation when command actually fails ([9b7973d](https://github.com/isanchez31/opencode-sandbox-plugin/commit/9b7973dbf8e0d56fff5faca60d5bb270f6055e93))
* remove block detection, let AI interpret sandbox errors directly ([e7c9d9b](https://github.com/isanchez31/opencode-sandbox-plugin/commit/e7c9d9b35247fc4b21137425c208bc6a16d813a6))
* remove silent block detection to prevent false positives ([6145a72](https://github.com/isanchez31/opencode-sandbox-plugin/commit/6145a7291ad04a5519037d11447b867a85f0c348))
* **security:** reject unsafe broad write paths like "/" from worktree ([271aec6](https://github.com/isanchez31/opencode-sandbox-plugin/commit/271aec65a5ac803a21e711ab8e6e41ce87b955e3))
* strip bwrap loopback warning from UI output on all commands ([6807481](https://github.com/isanchez31/opencode-sandbox-plugin/commit/68074813e377bdc620a88b57895e793c3e1a0f20))


### Reverted

* roll back to v0.1.4 stable release ([19e34c8](https://github.com/isanchez31/opencode-sandbox-plugin/commit/19e34c8f916be1f5075da2fc21e7ff2c27817ca0))

## [0.1.18](https://github.com/isanchez31/opencode-sandbox-plugin/compare/v0.1.17...v0.1.18) (2026-02-14)


### Fixed

* **ci:** use plain version tags for release-please ([d0ea18e](https://github.com/isanchez31/opencode-sandbox-plugin/commit/d0ea18e56799371b594e9417339db2e6438800d1))

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
