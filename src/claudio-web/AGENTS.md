# Web Agent Rules

These rules apply when working in `src/claudio-web`.

- Always fix formatting issues with `vp check` and `vp check --fix` - even if they are not your changes. This ensures a consistent code style across the project.
- Comments are code smell and are not allowed. The code should be readable by itself. BDD comments (`# given`, `# when`, `# then`), linter directives (`# noqa`, `// @ts-ignore`), shebangs, and similar tool-required comments are allowed.
- Avoid using `useEffect` in React components when possible. See: https://react.dev/learn/you-might-not-need-an-effect.
- React components are `PascalCase`, hooks are `useCamelCase`.
- Tailwind classes are used for styling in JSX, with semantic tokens for colors and spacing.
- Only one React component per file.
- Limit source files to 400 lines for readability. If a file grows too large, split it into smaller modules or helpers instead of extending the monolith.
- When adding new dependencies, ensure they are necessary and do not bloat the application. Make sure to use the latest stable versions and check for any known vulnerabilities.
- Write unit tests for new functionality and ensure existing tests are updated if necessary. Aim for high test coverage to catch potential issues early.
- Follow the existing code style and conventions used in the web codebase to maintain consistency and readability across the project.
