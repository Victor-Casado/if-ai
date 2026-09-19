# if-ai

[![CI](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Pull request checks, written in plain English.**

Stop leaving the same "where's the test plan?" comment. Write the rule once and let CI check every PR. if-ai uses [Jev](https://typesafe.ai) to evaluate a PR description or diff, then returns a boolean and a confidence score.

```yaml
- uses: Victor-Casado/if-ai@v0.3.0
  with:
    condition: The PR description includes a concrete test plan.
    min-confidence: '0.90'
    mode: pr-body
    api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

The check passes only when the condition is true **and** confidence meets your threshold. False answers, low confidence, and API errors fail the check.

## What would you check?

| Rule                                                                                                          | Mode       |
| ------------------------------------------------------------------------------------------------------------- | ---------- |
| The description explains the problem and includes a concrete test plan.                                       | `pr-body`  |
| This change does not remove or weaken existing tests.                                                         | `diff`     |
| New user-facing error messages explain how to recover. Changes without error messages satisfy this condition. | `per-file` |

Use `diff` when the rule needs context across files. Use `per-file` when every file must satisfy the rule independently. It evaluates up to four files at once and names failures in one job summary.

if-ai puts repeated review questions into CI so contributors can address them before a reviewer arrives. You supply the rule and the confidence threshold. There is no if-ai account, server, or subscription, just an API key and a workflow. You pay for inference and any applicable GitHub runner usage.

## Add it to your repo

1. Create an [OpenRouter API key](https://openrouter.ai/settings/keys).
2. Save it as the Actions secret `OPENROUTER_API_KEY` in your repository settings.
3. Add `.github/workflows/if-ai.yml`:

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
    # For fork PRs, use the approval-gated example linked below.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: Victor-Casado/if-ai@v0.3.0
        id: policy
        with:
          condition: This change does not remove or weaken existing tests.
          min-confidence: '0.90'
          mode: diff
          api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

This workflow evaluates same-repository PRs. Fork PRs are skipped. For public contributions, use the [fork workflow](examples/fork-pr.yml) and configure its required-review environment to approve paid runs. Dependabot needs its own secret configuration.

Try the rule on representative PRs, then make the `if-ai` job required in your repository rules. Pin the Action to a release's full commit SHA for an immutable installation.

OpenRouter is the default and runs `typesafe/jev-1.13` through its [alpha Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request). Other chat models are not supported. For a direct TypeSafe key, set `provider: typesafe` and pass `${{ secrets.TYPESAFE_API_KEY }}` to `api-key`.

**Upgrading from v0.2:** the default provider changed from TypeSafe to OpenRouter. Existing TypeSafe users must add `provider: typesafe` before upgrading.

## Cost and benchmarks

[OpenRouter lists Jev](https://openrouter.ai/typesafe/jev-1.13) at **$0.042 per million input tokens**, with no output-token charge, as of September 19, 2026. At that rate, an evaluation with 5,000 billable input tokens costs $0.00021; 1,000 such evaluations cost $0.21. This is a pricing estimate, not a measured benchmark. It excludes credit-purchase fees and runner costs.

`pr-body` and `diff` make one request. `per-file` makes one request per readable file that fits the request limit, repeating the condition each time. Check costs therefore depend on both content size and file count.

Benchmarks are pending. We have not measured review time saved or speed and cost savings against another model.

| Measurement                       | Result            |
| --------------------------------- | ----------------- |
| Median and p95 request latency    | Pending benchmark |
| Billed cost per check             | Pending benchmark |
| Verdicts against labeled examples | Pending benchmark |
| Comparison with another model     | Pending benchmark |

## Results you can use

The Action fails the step when the rule does not pass. It also exposes `result`, `confidence`, `status`, `failed-files`, and per-evaluation `results`. GitHub Actions outputs are strings; compare `result` with `'true'` explicitly.

In per-file mode, **every file must pass**. The overall confidence is the lowest file confidence. An operational error returns `result: 'false'`, `status: 'error'`, and `confidence: '0'`.

See the [input and output reference](docs/reference.md) for exact fields and limits. Complete workflows cover [PR descriptions](examples/pr-body.yml), [full diffs](examples/diff.yml), [per-file rules](examples/per-file.yml), and [fork PRs](examples/fork-pr.yml).

## Know the limits

Jev makes a model judgment. Confidence is not measured accuracy, and PR content can try to manipulate the answer. Keep tests, scanners, and human review for decisions that need them.

Diff modes read every change hunk, not the entire repository. Oversized requests, binary files, LFS pointers, and submodules fail explicitly; content is never silently truncated. Requests have a 30-second deadline and no retries. See [all limits](docs/reference.md#limits-and-privacy).

Selected PR content goes to TypeSafe through OpenRouter by default. if-ai has no backend or telemetry. Read [SECURITY.md](SECURITY.md) before using secrets with fork PRs or sending private code.

## Contributing

Use Node.js 24 and Git, then run `npm ci` and `npm run check`. Tests run offline and need no API key. [CONTRIBUTING.md](CONTRIBUTING.md) explains the code layout and PR process; [Maintaining](docs/maintaining.md) covers releases and repository settings.

[MIT](LICENSE). Independent project; not affiliated with TypeSafe, OpenRouter, or GitHub.
