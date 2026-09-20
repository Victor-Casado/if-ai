# if-ai

[![CI](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Victor-Casado/if-ai/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Marketplace](https://img.shields.io/badge/marketplace-if--ai%20PR%20Check-8957e5)](https://github.com/marketplace/actions/if-ai-pr-check)

**Write a pull request rule in plain English. The check fails when a PR breaks it.**

You keep leaving the same review comment. _Where's the test plan? You deleted that test._ Write it once. CI says it from now on.

## Paste this

Two minutes, three steps.

**1.** Get an [OpenRouter key](https://openrouter.ai/settings/keys).

**2.** Repo → Settings → Secrets → Actions → New secret, named `OPENROUTER_API_KEY`.

**3.** Save this as `.github/workflows/if-ai.yml`:

```yaml
name: if-ai
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
jobs:
  condition:
    name: if-ai
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: Victor-Casado/if-ai@v1.2.0
        with:
          condition: This change does not remove or weaken existing tests.
          min-confidence: '0.90'
          mode: diff
          api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

Done. Open a PR that guts a test and watch it go red.

Change the `condition:` line to whatever you actually care about. That line is the product.

The tag above is readable; a tag is also movable. This step receives your API key, so pin it to a commit once you are past trying it out. Every [release](https://github.com/Victor-Casado/if-ai/releases) lists its full SHA:

```yaml
- uses: Victor-Casado/if-ai@<full-sha-from-the-release> # v1.2.0
```

## Rules people write

| Rule                                                                                                          | `mode`     |
| ------------------------------------------------------------------------------------------------------------- | ---------- |
| The description explains the problem and includes a concrete test plan.                                       | `pr-body`  |
| This change does not remove or weaken existing tests.                                                         | `diff`     |
| Database migrations are reversible or say in the description why they are not.                                | `diff`     |
| No feature flag is deleted in the same PR that changes the code behind it.                                    | `diff`     |
| New user-facing error messages explain how to recover. Changes without error messages satisfy this condition. | `per-file` |

`pr-body` reads the description. `diff` reads the whole changeset. `per-file` judges each file on its own and names the ones that fail.

Rules a regex can check should stay a regex. This is for the judgment calls you currently make by hand.

## $0.21 per thousand checks

No subscription, no account, no bot to install. You bring an API key. A check over a 5,000-token diff costs **$0.00021**, because [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) is priced at $0.042 per million input tokens with output free.

Most checks come back in under half a second.

## When it fails

The step goes red and the job summary names the files, so the contributor can fix it without waiting for you:

## if-ai: failed

Mode: per-file. Minimum confidence: 0.85. Every subject must pass.

| Subject               | Result          | Confidence |
| --------------------- | --------------- | ---------- |
| `src/auth/session.ts` | condition-false | 0.93       |
| `src/api/client.ts`   | low-confidence  | 0.71       |
| `src/api/types.ts`    | passed          | 0.97       |

The check passes only when the rule is true **and** confidence clears your threshold. A false verdict fails it, so does low confidence, so does an API error.

The same values come back as step outputs: `result`, `confidence`, `status`, `failed-files`, and a `results` array. Actions outputs are strings, so compare `result` with `'true'` explicitly.

## Why it is this cheap

if-ai does not call a chat model. It calls Jev, which gives up text generation entirely and returns a typed verdict with a calibrated probability. Nothing to parse, no output tokens to pay for.

TypeSafe published evaluations across four workflows. Averaged:

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

The frontier models are genuinely better. `sol` and `opus 5` buy another five or six accuracy points, and charge orders of magnitude more in both money and time for them. For "did this PR delete a test," that is not a trade worth making.

**Read those numbers carefully.** They are TypeSafe's own evaluations, run on their four workflows: security incidents, agent-trace observability, invoice processing, and customer service. "Accuracy" there means agreement with the averaged judgments of GPT-6 Astra and Claude Fable 5.1, not ground truth.

None of it is pull request review, and none of it is if-ai. It tells you what class of model you are buying. It does not tell you how well your rule will work, and nobody can tell you that except your own PRs. [Full methodology and per-workflow results.](https://evals.typesafe.ai/)

## Know the limits

A passing check is advisory. Confidence is calibrated certainty, not measured accuracy, and PR content can try to talk the model into a verdict it wants. Keep your tests, your scanners, and your human reviewers for the decisions that need to be right.

Run it on real PRs for a week before you make the `if-ai` job required.

The workflow above skips fork PRs, which means a required if-ai check does not cover them: a skipped job satisfies a required check. Use the [fork workflow](examples/fork-pr.yml) with its approval-gated environment if that gap matters. Dependabot needs its own secret configuration.

Diff modes read every change hunk with three context lines, not the whole repository, and need a full-history checkout. Scope a rule with `paths` so it only sees the files it is about. The provider decides how much content it can evaluate and its rejection is reported, rather than guessed at in advance. Binary files, LFS pointers, and submodules fail explicitly; content is never silently truncated. Every numeric limit is a budget with a default you can change.

Your diff or description goes to TypeSafe, through OpenRouter by default. Read [SECURITY.md](SECURITY.md) before pointing this at private code or wiring secrets into fork workflows. For a direct TypeSafe key, set `provider: typesafe`.

if-ai runs only as a workflow step. No CLI, no library, no backend, no telemetry.

This repository runs if-ai on its own pull requests: [`.github/workflows/if-ai.yml`](.github/workflows/if-ai.yml).

Every input, output, and limit is in the [reference](docs/reference.md). Working workflows: [PR descriptions](examples/pr-body.yml), [full diffs](examples/diff.yml), [per-file rules](examples/per-file.yml), [fork PRs](examples/fork-pr.yml).

## Contributing

Use Node.js 24 and Git, then run `npm ci` and `npm run check`. Tests run offline and need no API key. [CONTRIBUTING.md](CONTRIBUTING.md) explains the code layout and PR process; [Maintaining](docs/maintaining.md) covers releases and repository settings.

[MIT](LICENSE). Independent project; not affiliated with TypeSafe, OpenRouter, or GitHub.
