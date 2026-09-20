# Action reference

if-ai runs as a step in a GitHub Actions workflow on a `pull_request` or `pull_request_target` event. That is the only supported way to run it; there is no CLI or importable library. See the [README](../README.md) for installation and [examples/](../examples/) for complete workflows.

## Modes

| Mode       | Jev reads                                               | Use it for                                               |
| ---------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `pr-body`  | The PR description from the event                       | Description requirements, such as a concrete test plan   |
| `diff`     | All text changes in one request                         | Conditions involving related changes across files        |
| `per-file` | One file patch per request, up to four requests at once | A rule that each changed file must satisfy independently |

## Scoping a rule with `paths`

`paths` takes [Git pathspecs](https://git-scm.com/docs/gitglossary#Documentation/gitglossary.txt-aiddefpathspecapathspec), one per line, and filters the changed files before anything is evaluated. Globs and exclusions both work, because pathspec magic is enabled:

```yaml
paths: |
  src/**
  :(exclude)src/**/*.test.ts
```

Filtering happens before the 200-file limit, so a large pull request scoped to a few files is evaluated rather than rejected. In `per-file` mode this is also the cost control: one paid call per matching file instead of one per changed file.

A rule scoped to `src/**` does not apply to a documentation-only pull request. That run reports `skipped` and passes, rather than asking the model to reason about a diff containing no relevant evidence.

Up to 50 entries, each 200 UTF-8 bytes or fewer. Entries are passed to Git after `--`, so a leading dash is a path and never an option.

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
| `paths`          | No       | Git pathspecs, one per line, limiting which changed files are evaluated. Ignored in `pr-body` mode.                    |
| `model`          | No       | Defaults to `jev-1.13.0` for TypeSafe or `typesafe/jev-1.13` for OpenRouter. Use the selected provider's Jev model ID. |

For per-file rules, say how unrelated files should be treated. For example: "Any new user-facing error message explains how to recover. Changes without error messages satisfy this condition."

Try your rule against representative PRs before making the job required. Use deterministic checks for rules such as file-path matching.

## Results

| Outcome                                      | `result`  | `status`  | Check |
| -------------------------------------------- | --------- | --------- | ----- |
| Every answer is true and meets the threshold | `'true'`  | `passed`  | Pass  |
| No changed file matched `paths`              | `'true'`  | `skipped` | Pass  |
| Any answer is false or below the threshold   | `'false'` | `failed`  | Fail  |
| Input, Git, network, or API error            | `'false'` | `error`   | Fail  |

An empty body or diff is an error. Confidence equal to the threshold passes.

Outputs are strings in GitHub Actions:

| Output         | Meaning                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `result`       | Compare explicitly with `'true'`.                                                                            |
| `confidence`   | Jev's confidence, or the minimum file confidence in per-file mode. `0` on any operational error.             |
| `status`       | `passed`, `failed`, or `error`.                                                                              |
| `failed-files` | JSON array of failed paths in per-file mode, or unreadable paths in diff mode. Empty for aggregate verdicts. |
| `results`      | JSON array of `name`, `status`, `confidence`, and optional sanitized `error` for each evaluation.            |

A `skipped` run calls no API and costs nothing. It reports `confidence: '1'` and an empty `results` array: an empty conjunction is true, and nothing was uncertain because nothing was evaluated. Read `status` before reading `confidence`.

Individual statuses are `passed`, `condition-false`, `low-confidence`, or `error`. An individual error has `confidence: null`. Validation failures before evaluation leave the arrays empty.

if-ai uses Jev's two-option Choice API to obtain native confidence. The minimum file confidence is not a joint probability, and model confidence is not measured accuracy. [TypeSafe explains the distinction](https://docs.typesafe.ai/confidence).

Use `if: always()` on a later step to inspect outputs after failure. Pass outputs through environment variables when using them in shell commands.

## Skipped jobs and required checks

GitHub reports a job skipped by its `if` as the `skipped` conclusion, and counts that as satisfying a required status check. Two consequences are worth knowing before making an if-ai job required.

A workflow that skips fork PRs leaves them unevaluated but green. That is the documented behavior of the same-repository pattern, not a defect, but it means the rule protects your own branches rather than contributions.

More subtly, GitHub evaluates the most recent check run for each name on a commit. If a job runs on one event and skips on another for the same commit, the skip replaces the earlier verdict, including a failure. Guard against an event by leaving it out of the workflow's `types` rather than by skipping the job, so no run is created and nothing is superseded.

## Limits and privacy

- Each request is limited to 28,000 UTF-8 bytes, including the condition and JSON framing. Oversized input fails without truncation. Per-file mode helps when each individual patch fits. This figure is the Action's own conservative limit, not a published provider constraint; see the note below.
- A single Git command may produce at most 2 MB of output. Node buffers a child process's output in memory, so this is a hard ceiling on what the Action can read at all rather than a policy choice. Exceeding it reports the pull request as too large, and suggests per-file mode or `paths`.
- Diff modes accept up to 200 changed paths. Binary files, LFS pointers, submodules, non-UTF-8 patches, and incomplete Git output fail explicitly. Per-file mode still evaluates the other readable files.
- Each request has a 30-second deadline covering every attempt. A rate limit (HTTP 429) or a server fault (HTTP 5xx) is retried once inside that deadline, honoring `Retry-After` up to 10 seconds; the retry is logged. A provider asking for longer than 10 seconds, or longer than the deadline has left, reports the status instead of waiting. Request faults such as 401, 402, and 422 are not retried, and neither are timeouts or transport failures. A retried request is a second paid call. A per-file run makes one paid call per readable, in-limit file; set a job timeout.
- The selected content and condition go to TypeSafe, directly or through OpenRouter according to `provider`. if-ai has no backend or telemetry. Logs and summaries contain paths, scores, and sanitized errors, not source or provider response bodies.

PR content can attempt to manipulate the model. Keep tests, scanners, and review for decisions that need them. See [SECURITY.md](../SECURITY.md) for credential and fork-workflow guidance.
