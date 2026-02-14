# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in opencode-sandbox, please report it responsibly.

**Do not open a public issue.**

Instead, email **ivan31.sanchez@gmail.com** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. Once confirmed, a fix will be prioritized and released as a patch version.

## Scope

This project sandboxes agent-executed commands using OS-level isolation. Security issues of particular interest include:

- Sandbox escape (writing outside allowed paths)
- Network allowlist bypass
- Credential exposure through sandbox misconfiguration
- Path traversal in configuration handling
