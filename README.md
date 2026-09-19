# if-ai

[![CI](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Write a pull request check in plain English. Supply a condition and a minimum confidence; [Jev](https://typesafe.ai) evaluates the PR body, the full text diff, or each changed file.

The check passes only when the condition is true and confidence meets your threshold. In per-file mode, every file must pass. Failed files appear in the job summary.

## Quick start

Get a key from the [TypeSafe console](https://console.typesafe.ai/) and save it as the repository Actions secret `TYPESAFE_API_KEY`. Add this workflow at `.github/workflows/if-ai.yml`:

```yaml
name: if-ai
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
permissions:
  contents: read
jobs:
  condition:
    name: if-ai
    # Fork PRs need the approval-gated example linked below.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: Victor-Casado/if-ai@v0.2.0
        id: policy
        with:
          condition: This change does not remove or weaken existing tests.
          min-confidence: '0.90'
          mode: diff
          api-key: ${{ secrets.TYPESAFE_API_KEY }}
```

This example covers same-repository PRs. Fork PRs are skipped, not evaluated. For public contributions, use the [fork workflow](examples/fork-pr.yml) with a required-review environment to approve each paid run. Dependabot needs its own secret configuration.

For immutable installation, pin if-ai to the release's full commit SHA. Add the `if-ai` job to your repository rules if it should block merging.

## OpenRouter

Save an [OpenRouter key](https://openrouter.ai/settings/keys) as `OPENROUTER_API_KEY`. In the workflow above, set:

```yaml
with:
  condition: This change does not remove or weaken existing tests.
  min-confidence: '0.90'
  mode: diff
  provider: openrouter
  api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

This still runs Jev and uses its native confidence. It calls OpenRouter's [alpha Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request), which may change. Other OpenRouter chat models are not supported. The provider is explicit; if-ai never guesses from a key or falls back to another provider.

## Modes

| Mode       | Jev reads                                               | Use it for                                               |
| ---------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `pr-body`  | The PR description from the event                       | Description requirements, such as a concrete test plan   |
| `diff`     | All text changes in one request                         | Conditions involving related changes across files        |
| `per-file` | One file patch per request, up to four requests at once | A rule that each changed file must satisfy independently |

`diff` is the default. Diff modes require a full-history checkout containing the PR event's base and head commits. The comparison runs from their merge base to the exact head commit. It includes every change hunk and three context lines, not every line of the repository. No paths are filtered out. Renames appear as a deletion and an addition.

Per-file evaluations cannot see other files. PR-body mode checks the description, not whether the implementation matches it.

## Inputs

| Input            | Required | Description                                                                                                            |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `condition`      | Yes      | Statement that must be true. Up to 4,000 UTF-8 bytes.                                                                  |
| `min-confidence` | Yes      | Number from `0` to `1`, inclusive, such as `'0.90'`. No default.                                                       |
| `api-key`        | Yes      | Key for the selected provider, supplied as a secret.                                                                   |
| `provider`       | No       | `typesafe` or `openrouter`. Defaults to `typesafe`.                                                                    |
| `mode`           | No       | `pr-body`, `diff`, or `per-file`. Defaults to `diff`.                                                                  |
| `model`          | No       | Defaults to `jev-1.13.0` for TypeSafe or `typesafe/jev-1.13` for OpenRouter. Use the selected provider's Jev model ID. |

For per-file rules, say how unrelated files should be treated. For example: "Any new user-facing error message explains how to recover. Changes without error messages satisfy this condition."

Try your rule against representative PRs before making the job required. Use deterministic checks for rules such as file-path matching.

## Results

| Outcome                                      | `result`  | `status` | Check |
| -------------------------------------------- | --------- | -------- | ----- |
| Every answer is true and meets the threshold | `'true'`  | `passed` | Pass  |
| Any answer is false or below the threshold   | `'false'` | `failed` | Fail  |
| Input, Git, network, or API error            | `'false'` | `error`  | Fail  |

An empty body or diff is an error. Confidence equal to the threshold passes.

Outputs are strings in GitHub Actions:

| Output         | Meaning                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `result`       | Compare explicitly with `'true'`.                                                                            |
| `confidence`   | Jev's confidence, or the minimum file confidence in per-file mode. `0` on any operational error.             |
| `status`       | `passed`, `failed`, or `error`.                                                                              |
| `failed-files` | JSON array of failed paths in per-file mode, or unreadable paths in diff mode. Empty for aggregate verdicts. |
| `results`      | JSON array of `name`, `status`, `confidence`, and optional sanitized `error` for each evaluation.            |

Individual statuses are `passed`, `condition-false`, `low-confidence`, or `error`. An individual error has `confidence: null`. Validation failures before evaluation leave the arrays empty.

if-ai uses Jev's two-option Choice API to obtain native confidence. Noul has no separate confidence field. The minimum file confidence is not a joint probability, and model confidence is not measured accuracy. [TypeSafe explains the distinction](https://docs.typesafe.ai/confidence).

Use `if: always()` on a later step to inspect outputs after failure. Pass outputs through environment variables when using them in shell commands.

## Limits and privacy

- Each request is limited to 28,000 UTF-8 bytes, including the condition and JSON framing. Oversized input fails without truncation. Per-file mode helps when each individual patch fits.
- Diff modes accept up to 200 changed paths. Binary files, LFS pointers, submodules, non-UTF-8 patches, and incomplete Git output fail explicitly. Per-file mode still evaluates the other readable files.
- Each request has a 30-second deadline and no retries. Rerun transient failures. A per-file run makes one paid call per readable, in-limit file; set a job timeout.
- The selected content and condition go to TypeSafe, directly or through OpenRouter according to `provider`. if-ai has no backend or telemetry. Logs and summaries contain paths, scores, and sanitized errors, not source or provider response bodies.

PR content can attempt to manipulate the model. Keep tests, scanners, and review for decisions that need them. See [SECURITY.md](SECURITY.md) for credential and fork-workflow guidance.

## Examples

- [PR description](examples/pr-body.yml): a clear problem statement and test plan.
- [Full diff](examples/diff.yml): preserve existing tests.
- [Per-file](examples/per-file.yml): check error-message quality and identify failures.
- [Fork PRs](examples/fork-pr.yml): approve paid runs, then read PR changes without executing contributor code.

## Contributing

Use Node.js 24 and Git:

```sh
npm ci
npm run check
```

Tests run offline. [CONTRIBUTING.md](CONTRIBUTING.md) covers the code layout, build, and PR process. [Maintaining](docs/maintaining.md) covers releases and repository settings.

[MIT](LICENSE). Independent project; not affiliated with TypeSafe or GitHub.
