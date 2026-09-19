# Action reference

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
| `provider`       | No       | `typesafe` or `openrouter`. Defaults to `openrouter`.                                                                  |
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

if-ai uses Jev's two-option Choice API to obtain native confidence. The minimum file confidence is not a joint probability, and model confidence is not measured accuracy. [TypeSafe explains the distinction](https://docs.typesafe.ai/confidence).

Use `if: always()` on a later step to inspect outputs after failure. Pass outputs through environment variables when using them in shell commands.

## Limits and privacy

- Each request is limited to 28,000 UTF-8 bytes, including the condition and JSON framing. Oversized input fails without truncation. Per-file mode helps when each individual patch fits.
- Diff modes accept up to 200 changed paths. Binary files, LFS pointers, submodules, non-UTF-8 patches, and incomplete Git output fail explicitly. Per-file mode still evaluates the other readable files.
- Each request has a 30-second deadline and no retries. Rerun transient failures. A per-file run makes one paid call per readable, in-limit file; set a job timeout.
- The selected content and condition go to TypeSafe, directly or through OpenRouter according to `provider`. if-ai has no backend or telemetry. Logs and summaries contain paths, scores, and sanitized errors, not source or provider response bodies.

PR content can attempt to manipulate the model. Keep tests, scanners, and review for decisions that need them. See [SECURITY.md](../SECURITY.md) for credential and fork-workflow guidance.
