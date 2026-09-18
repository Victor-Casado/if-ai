# if-ai

**Write a pull request check in plain English.**

[![CI](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```yaml
- uses: Victor-Casado/if-ai@v0.1.0
  with:
    condition: This change does not remove or weaken existing tests.
    min-confidence: '0.90'
    mode: diff
    api-key: ${{ secrets.TYPESAFE_API_KEY }}
```

if-ai sends a PR body, its complete text diff, or each changed file's diff to [Jev](https://typesafe.ai). The check passes only when the condition is true **and** confidence meets your threshold. Both `condition` and `min-confidence` are required.

In `per-file` mode, every file must pass. Evaluations run concurrently inside one job, and the summary names every failed file. No separate service, GitHub App, or database to run.

## Quick start

1. Get a direct TypeSafe API key from the [TypeSafe console](https://console.typesafe.ai/).
2. Add it to your repository's Actions secrets as `TYPESAFE_API_KEY`.
3. Save this as `.github/workflows/if-ai.yml`:

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
    # Fork PRs do not receive repository secrets. See the fork example below.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: Victor-Casado/if-ai@v0.1.0
        id: policy
        with:
          condition: This change does not remove or weaken existing tests.
          min-confidence: '0.90'
          mode: diff
          api-key: ${{ secrets.TYPESAFE_API_KEY }}
```

For immutable dependencies, replace the if-ai release tag with its full commit SHA. This quickstart covers same-repository PRs. For public contributions, use the [fork PR workflow](examples/fork-pr.yml), which checks out the trusted base and fetches the PR head only as Git data. A skipped fork job is not a completed evaluation. Dependabot may also lack the repository secret.

Add the `if-ai` job as a required check in your repository rules if it should block merging. A failing Action alone does not configure branch protection.

## Choose what Jev reads

| `mode` | Content evaluated | Pass rule |
| --- | --- | --- |
| `pr-body` | The PR description from the event snapshot | The description satisfies the condition at your confidence threshold |
| `diff` | All text changes, in one request | The combined diff satisfies the condition at your threshold |
| `per-file` | One complete file patch per request, up to four requests at once | Every file satisfies the condition at your threshold |

`diff` is the default. Diff modes require a full-history checkout containing the event's base and head commits. We compare the merge base to the exact event head, ignoring uncommitted files and subsequent branch updates. No changed file is filtered out. Renames appear as deletion of the old path and addition of the new path; both are evaluated in per-file mode.

"Complete diff" means every change hunk with three surrounding context lines. It does not mean the entire contents of every file, or the whole repository. Use `diff` for conditions that depend on relationships between files. In `per-file`, each evaluation sees only that file's patch; a condition such as "every code change has a test in another file" needs `diff`.

PR-body mode evaluates what the description says. It cannot establish whether the code matches that description.

## Inputs

| Input | Required | Description |
| --- | --- | --- |
| `condition` | Yes | Plain-English statement that must be true. Maximum 4,000 UTF-8 bytes. |
| `min-confidence` | Yes | Number between `0` and `1`, inclusive. For example, `'0.90'`. No default. |
| `api-key` | Yes | Direct TypeSafe API key, supplied as a secret. |
| `mode` | No | `pr-body`, `diff`, or `per-file`. Default `diff`. |
| `model` | No | Default `jev-1.13.0`. Pin a version when tuning your conditions. |

Choose a condition that applies to every selected subject. For per-file checks, explain how unrelated files should be treated, for example: "Any newly added user-facing error message explains how to recover. Changes without user-facing error messages satisfy this condition."

Thresholds are your policy, not a guarantee. Try conditions against representative PRs before making the job required.

## Results and failure behavior

| Situation | `result` | `status` | Check |
| --- | --- | --- | --- |
| Every answer is true and confidence is at least the threshold | `'true'` | `passed` | Pass |
| Any answer is false or below the threshold | `'false'` | `failed` | Fail |
| Missing input, unreadable content, timeout, API error, or malformed response | `'false'` | `error` | Fail |

An empty PR body or empty diff is an error. Low confidence fails even if Jev selected true. The threshold comparison is inclusive.

Outputs are GitHub Actions strings:

| Output | Meaning |
| --- | --- |
| `result` | `'true'` only when the entire check passes. Compare explicitly with `'true'`. |
| `confidence` | Native confidence for one evaluation; minimum file confidence in per-file mode. `0` on any operational error. |
| `status` | `passed`, `failed`, or `error`. |
| `failed-files` | JSON array of failed file paths in per-file mode. Also identifies unreadable files in diff mode. Empty for a combined-diff verdict or PR-body verdict. |
| `results` | JSON array with each subject's `name`, `status`, `confidence`, and optional sanitized `error`. Per-subject statuses are `passed`, `condition-false`, `low-confidence`, or `error`. |

Per-file confidence is a minimum, **not** the probability that all files are correct. An individual API error has `confidence: null` in `results`; aggregate `0` is a failure sentinel. If validation fails before subjects are available, the arrays are empty.

After a failed step, downstream steps normally stop. Use `if: always()` to inspect outputs without hiding the failure:

```yaml
- name: Print check status
  if: always()
  env:
    STATUS: ${{ steps.policy.outputs.status }}
    RESULT: ${{ steps.policy.outputs.result }}
  run: printf 'if-ai status=%s result=%s\n' "$STATUS" "$RESULT"
```

The job summary shows per-file results. For example, this **illustrative** result fails a threshold of `0.90`:

| Subject | Result | Confidence |
| --- | --- | --- |
| `src/parser.ts` | passed | 0.96 |
| `src/errors.ts` | condition-false | 0.94 |
| `test/parser.test.ts` | low-confidence | 0.71 |

## Limits and data handling

- Requests are capped at 28,000 UTF-8 bytes including the condition and JSON framing. This is a conservative application limit, not Jev's token limit. Oversized content fails without truncation. Per-file mode helps only if each file fits.
- Diff modes support up to 200 changed paths. Binary files, Git LFS pointers, submodules, non-UTF-8 patches, and incomplete Git output fail explicitly. In per-file mode, other files are still evaluated and all failures are reported.
- Each request has a 30-second deadline and is sent once. Authentication errors, rate limits, and service failures provide a short diagnostic. Rerun transient failures; automatic retries are intentionally omitted to bound cost and duration.
- Per-file mode makes one paid API call for each readable, in-limit file, with up to four calls in flight. Set a workflow timeout for the whole job.
- The selected body or source diff and your condition leave the runner and go directly to TypeSafe. There is no if-ai backend or telemetry. We do not print source content or provider response bodies. File names, scores, and sanitized errors appear in outputs and summaries.
- Jev's confidence is a statistic of its answer distribution, not measured correctness. if-ai uses a two-option **Choice** because Noul returns a yes-probability without native confidence. See [TypeSafe's confidence documentation](https://docs.typesafe.ai/confidence).

PR text and diffs can contain adversarial instructions. The prompt treats them as data, but prompt wording does not make model judgments a security boundary. Keep tests, scanners, and human review for decisions that need them. Do not execute untrusted PR code in a job holding the TypeSafe key. See [SECURITY.md](SECURITY.md).

## Examples

- [PR description quality](examples/pr-body.yml): require a clear problem statement and test plan, without a checkout.
- [Test preservation across the entire diff](examples/diff.yml): assess related changes together.
- [Error-message quality per file](examples/per-file.yml): every file passes, or the summary identifies failures.
- [Fork PRs](examples/fork-pr.yml): read the full diff from a trusted workflow without checking out or executing the contributor's code.

Use deterministic tools for deterministic rules such as matching file paths. if-ai is useful for conditions about meaning. [Research notes](docs/research/overlap-and-mvp.md) compare existing AI Actions and Jev integrations.

## Development

Node.js 24 and Git are required. The Action runs on the Node 24 GitHub runtime; it does not need an npm install in consuming workflows.

```sh
npm ci
npm run check
```

Tests use temporary Git repositories and mocked HTTP responses. They exercise the bundled entrypoint, output files, process exit codes, concurrency, and failure cases without an API key. `npm run build` regenerates the committed `dist/index.cjs`. CI verifies that the bundle matches source on Linux and Windows.

The optional **Live Jev smoke test** workflow uses the `TYPESAFE_API_KEY` repository secret. It is manually triggered and incurs API usage. Offline tests establish implementation behavior; they do not establish model accuracy. See [release notes and validation](docs/releasing.md) for launch status.

Bug reports and focused PRs are welcome. Include a sanitized reproduction and expected behavior. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Independent project; not affiliated with TypeSafe or GitHub.
