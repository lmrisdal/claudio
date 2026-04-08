# Desktop Agent Rules

These rules apply when working in `src/claudio-desktop`.

- Preserve detailed path-aware error logging for install, extraction, staging, and cleanup failures. If code returns a user-friendly I/O error, make sure `claudio.log` still records the exact failing operation and paths.
- Do not revert `cargo fmt` output just to keep a diff smaller. If `cargo fmt` reformats touched desktop files, keep those formatting changes.
- Comments are code smell and are not allowed. The code should be readable by itself. BDD comments (`# given`, `# when`, `# then`), linter directives (`# noqa`, `// @ts-ignore`), shebangs, and similar tool-required comments are allowed.
- Limit source files to 400 lines for readability. If a file grows too large, split it into smaller modules or helpers instead of extending the monolith.
