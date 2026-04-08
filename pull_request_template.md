## Pull Request

### Title: Add macOS unsafe write paths to sandbox protection

**Fixes #33**

This PR adds comprehensive macOS system path protection by expanding the `UNSAFE_WRITE_PATHS` set to include:
- `/Library` - macOS system libraries and preferences
- `/System` - Core macOS system files (protected since Catalina)
- `/private` - macOS's actual system root (hidden from users)
- `/Volumes` - External mounted drives
- `/Users` - macOS equivalent to Linux's /home

These additions ensure that the sandbox properly protects critical macOS system directories from being written to, improving overall security.