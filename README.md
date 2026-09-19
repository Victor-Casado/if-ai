# if-ai

[![CI](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A GitHub Action that checks pull requests against a rule you write in plain English.**

You keep leaving the same review comment. _Where's the test plan? You deleted that test._ Write the rule once as a workflow step, and every PR gets checked before a human opens it.

```yaml
- uses: Victor-Casado/if-ai@v0.3.0
  with:
    condition: This change does not remove or weaken existing tests.
    min-confidence: '0.90'
    mode: diff
    api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

That is the whole configuration. The check passes only when the condition is true **and** the model's confidence clears your threshold. A false verdict fails it, so does low confidence, so does an API error.

## $0.21 per thousand checks

if-ai does not call a chat model. It calls [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), a decision-only model that gives up text generation entirely and returns a typed verdict with a calibrated probability. There is no prose to parse and no output tokens to pay for.

OpenRouter lists Jev at **$0.042 per million input tokens, with output free**. A check over a 5,000-token diff costs **$0.00021**. A thousand of them cost **$0.21**.

The speed comes from the same design. TypeSafe published evaluations across four workflows; averaged, they look like this:

| Model       | Accuracy  | Cost per case | Time per case |
| ----------- | --------- | ------------- | ------------- |
| **Jev**     | **67.8%** | **$0.0004**   | **0.4 s**     |
| `sonnet 5`  | 67.8%     | $0.1174       | 78.1 s        |
| `terra`     | 67.9%     | $0.0304       | 10.1 s        |
| `opus 5`    | 73.1%     | $0.1761       | 37.8 s        |
| `sol`       | 74.1%     | $0.0836       | 23.3 s        |
| `DS v4 pro` | 65.5%     | $0.0413       | 86.5 s        |
| `haiku 4.5` | 53.6%     | $0.0195       | 12.5 s        |

Jev and `sonnet 5` tie at 67.8%. One costs $0.0004 and answers in under half a second; the other costs $0.1174 and takes 78 seconds. TypeSafe summarizes that pair as [193.6x faster and 444.6x cheaper](https://typesafe.ai/).

The frontier models are genuinely better. `sol` and `opus 5` buy you another five or six accuracy points, and they charge orders of magnitude more in both money and time for them. For "did this PR delete a test," that is not a trade worth making.

**Read those numbers carefully.** They are TypeSafe's own evaluations, run on their four workflows: security incidents, agent-trace observability, invoice processing, and customer service. "Accuracy" there means agreement with the averaged judgments of GPT-6 Astra and Claude Fable 5.1, not ground truth.

None of it is pull request review, and none of it is if-ai. It tells you what class of model you are buying. It does not tell you how well your rule will work, and nobody can tell you that except your own PRs. [Full methodology and per-workflow results.](https://evals.typesafe.ai/)

## Rules worth writing

| Rule                                                                                                          | Mode       |
| ------------------------------------------------------------------------------------------------------------- | ---------- |
| The description explains the problem and includes a concrete test plan.                                       | `pr-body`  |
| This change does not remove or weaken existing tests.                                                         | `diff`     |
| New user-facing error messages explain how to recover. Changes without error messages satisfy this condition. | `per-file` |
| Database migrations are reversible or say in the description why they are not.                                | `diff`     |
| No feature flag is deleted in the same PR that changes the code behind it.                                    | `diff`     |

Use `diff` when the rule needs context across files. Use `per-file` when every file must satisfy the rule on its own; it evaluates four files at a time and names the failures.

Rules a regex can check should stay a regex. if-ai is for the judgment calls you currently make by hand.

## What a failure looks like

The step fails and the job summary names the files, so the contributor can fix it without waiting for you:

 ## if-ai: failed

 Mode: per-file. Minimum confidence: 0.85. Every subject must pass.

 | Subject               | Result          | Confidence |
 | --------------------- | --------------- | ---------- |
 | `src/auth/session.ts` | condition-false | 0.93       |
 | `src/api/client.ts`   | passed          | 0.97       |

The same values come back as step outputs: `result`, `confidence`, `status`, `failed-files`, and a `results` array. GitHub Actions outputs are strings, so compare `result` with `'true'` explicitly.

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

Run it on real PRs for a week before you make the `if-ai` job required. Pin the Action to a release's full commit SHA for an immutable install.

This workflow skips fork PRs. For public contributions, use the [fork workflow](examples/fork-pr.yml) and configure its required-review environment so every paid run is approved. Dependabot needs its own secret configuration.

if-ai runs only as a step in a GitHub Actions workflow. There is no CLI, no library, no bot to install, and no if-ai account, server, or subscription. You bring an API key and you own the rule; the Action has no backend and no telemetry. OpenRouter is the default and runs `typesafe/jev-1.13` through its [alpha Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request); for a direct TypeSafe key, set `provider: typesafe`.

## Know the limits

A passing if-ai check is advisory. Confidence is calibrated certainty, not measured accuracy, and PR content can try to talk the model into a verdict it wants. Keep your tests, your scanners, and your human reviewers for the decisions that need to be right.

Diff modes read every change hunk with three context lines, not the whole repository, and require a full-history checkout. Requests cap at 28,000 UTF-8 bytes and 200 changed paths. Oversized requests, binary files, LFS pointers, and submodules fail explicitly; content is never silently truncated. Each request has a 30-second deadline and no retries.

The selected diff or description goes to TypeSafe, through OpenRouter by default. Read [SECURITY.md](SECURITY.md) before pointing this at private code or wiring secrets into fork workflows.

See the [reference](docs/reference.md) for every input, output, and limit. Working workflows: [PR descriptions](examples/pr-body.yml), [full diffs](examples/diff.yml), [per-file rules](examples/per-file.yml), [fork PRs](examples/fork-pr.yml).

## Contributing

Use Node.js 24 and Git, then run `npm ci` and `npm run check`. Tests run offline and need no API key. [CONTRIBUTING.md](CONTRIBUTING.md) explains the code layout and PR process; [Maintaining](docs/maintaining.md) covers releases and repository settings.

[MIT](LICENSE). Independent project; not affiliated with TypeSafe, OpenRouter, or GitHub.
