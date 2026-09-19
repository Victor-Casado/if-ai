# Contributing

Report bugs and propose changes through [GitHub Issues](https://github.com/Victor-Casado/if-ai/issues). For a bug, include the action version, mode, condition, threshold, and a small reproduction with private content removed. Report vulnerabilities through [private reporting](SECURITY.md).

## Work locally

Use Node.js 24 and Git.

```sh
npm ci
npm run format
npm run check
```

`check` runs the formatter check, TypeScript checks, tests, and build. Tests use temporary repositories and mocked HTTP responses; no API key is needed.

GitHub executes the committed `dist/index.cjs` directly. Run `npm run build` after changing source or dependencies, and include the resulting `dist/` changes in your PR. Do not edit the bundle by hand. CI verifies that it matches the source on Linux and Windows.

## Find the code

| File            | Responsibility                                                  |
| --------------- | --------------------------------------------------------------- |
| `src/config.ts` | Validate workflow inputs and the PR event; define safe errors   |
| `src/git.ts`    | Collect complete patches for the event's exact commits          |
| `src/jev.ts`    | Build the Choice request, enforce limits, validate the response |
| `src/check.ts`  | Run bounded evaluations and require every result to pass        |
| `src/report.ts` | Escape values and render the job summary                        |
| `src/main.ts`   | Connect inputs, evaluations, outputs, and the step exit status  |

`test/git.test.ts` exercises real Git repositories. `test/evaluation.test.ts` covers the API contract and aggregation. `test/action.test.ts` runs the actual bundle in a child process and checks GitHub output files and exit codes.

## Send a PR

Keep the change focused and explain the behavior it changes. Add regression tests for fixes. Update `action.yml`, the README, and examples together when changing the public interface.

Use argument arrays for Git commands. Treat PR bodies, paths, and diffs as untrusted data. Never log API keys, request content, or raw provider errors. Keep error messages actionable and summaries escaped.

Main requires a PR, passing Linux and Windows checks, and resolved review conversations. The maintainer squash-merges accepted changes. External contributors' workflow runs require approval before CI starts.

For dependency updates, regenerate the bundle as well as the lockfile. A Dependabot PR with a stale bundle should fail CI until that is done.

Live API tests are separate from normal CI. The manual smoke workflow exercises all modes against Jev and consumes API quota. Passing fixtures verify integration behavior; they do not establish model accuracy.
