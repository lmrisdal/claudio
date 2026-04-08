# Desktop Agent Rules

These rules apply when working in `src/claudio-desktop`.

- Preserve detailed path-aware error logging for install, extraction, staging, and cleanup failures. If code returns a user-friendly I/O error, make sure `claudio.log` still records the exact failing operation and paths.
- Do not revert `cargo fmt` output just to keep a diff smaller. If `cargo fmt` reformats touched desktop files, keep those formatting changes.
- Comments are code smell and are not allowed. The code should be readable by itself. BDD comments (`# given`, `# when`, `# then`), linter directives (`# noqa`, `// @ts-ignore`), shebangs, and similar tool-required comments are allowed.
- Limit source files to 400 lines for readability. If a file grows too large, split it into smaller modules or helpers instead of extending the monolith.
- Avoid using `unwrap()` or `expect()` in desktop code. Instead, use proper error handling to ensure that any failure is logged with context and does not crash the application.
- Warnings from `cargo check` should not be ignored. Address all warnings to maintain code quality and prevent potential issues.
- When adding new dependencies, ensure they are necessary and do not bloat the application. Make sure to use the latest stable versions and check for any known vulnerabilities.
- Write unit tests for new functionality and ensure existing tests are updated if necessary. Aim for high test coverage to catch potential issues early.
- Follow the existing code style and conventions used in the desktop codebase to maintain consistency and readability across the project.
