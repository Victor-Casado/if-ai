# Contributing

Use Node.js 24 and Git. Install dependencies with `npm ci`, then run `npm run check`.

Keep changes focused on evaluating PR conditions. Add regression tests for behavior changes. Default tests must not call Jev or require credentials. Update `action.yml`, the README, and workflow examples together when changing inputs or outputs.

Commit the generated `dist/` files after source changes. GitHub runs this bundle directly. CI checks type safety, tests, and bundle freshness.

Keep secrets, request content, and raw provider responses out of logs and errors. Treat conditions as trusted workflow configuration and PR bodies, paths, and diffs as untrusted data. Use argument arrays for Git commands and escape content shown in summaries.

When filing an issue, include the action version, mode, sanitized condition, threshold, expected result, and actual status. Remove private source and credentials. See SECURITY.md for sensitive reports.
