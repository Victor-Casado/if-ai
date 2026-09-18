# if-ai research and proposed MVP

Researched 2026-09-18. This is a proposal, not an implementation specification. The workspace starts as an empty Git repository with no remote or commits. API details are in [jev-api.md](jev-api.md).

## Overlapping projects

| Project | Verified overlap | Implication for if-ai |
| --- | --- | --- |
| [actions/ai-inference](https://github.com/actions/ai-inference) | GitHub Models inference inside Actions, including prompt files and JSON schemas. | A generic AI Action already exists. Focus on a predictable condition interface. |
| [vercel/ai-action](https://github.com/vercel/ai-action) | Text and schema-constrained JSON generation through AI Gateway. | Structured output alone is insufficient differentiation. |
| [check-risk](https://github.com/moezubair/check-risk) | CLI and Action combining deterministic code-change rules with Jev judgments, checks, and reviewer recommendations. Its README marks live Jev validation pending. | Do not expand into code review or a policy engine. |
| [agent-gate-loop](https://github.com/Ripwords/agent-gate-loop) | An agent writes a change, checks and reviews it, then uses Jev in a retry/escalation loop. | A standalone condition could compose with workflows without owning an agent loop. |
| [pg-jev](https://github.com/realZachi/pg-jev) | Plain-language predicates over PostgreSQL rows. | The plain-English predicate idea has precedent outside CI. |
| [dorny/paths-filter](https://github.com/dorny/paths-filter) | Conditional execution based on changed paths. | Use deterministic matching for path rules; demonstrate semantic conditions instead. |
| [GitHub Agentic Workflows](https://github.com/github/gh-aw) | Natural-language workflows running in GitHub Actions. | Position if-ai as one composable decision step, with a much smaller scope. |

Searches covered GitHub, natural-language boolean Actions, and Jev integration directories. This is a focused comparison, not proof that an identical project does not exist. A GitHub account already uses [if-ai](https://github.com/if-ai); the eventual installation path should be the user's actual owner/if-ai repository.

## Recommendation

One invocation evaluates one condition against caller-supplied context. Ship a bundled TypeScript JavaScript Action, a copyable quickstart, three complete examples, offline tests, and explicit uncertainty/error behavior. Users supply their own TypeSafe API key. No hosted backend is needed.

Start with explicit text context rather than automatic repository inspection. This keeps data transmission visible and avoids GitHub permissions, diff pagination, checkout, and truncation policies in the core Action. A file input is a possible small addition if the first use case requires diffs or logs.

Jev's [Noul](https://docs.typesafe.ai/primitives/noul) returns a yes-probability, not a separate confidence field. [Choice confidence](https://docs.typesafe.ai/confidence) is a provider-computed statistic of the option distribution. For the promised boolean plus confidence interface, a two-option Choice is a reasonable proposal: map the selected true/false key to a boolean and preserve native confidence. Alternatively, Noul can expose probability and an explicitly named derived certainty measure. Do not describe either score as measured accuracy. Select the contract with the user before implementation.

Suggested outputs are result, confidence, and status. Keep a confident false separate from an uncertain decision and an operational failure. Fail the step by default for API errors or insufficient confidence; an explicit fallback policy can follow if required. A universal false fallback can accidentally skip necessary checks when the condition asks whether more testing is needed.

GitHub step outputs are strings, so examples should compare result to 'true' explicitly. See [GitHub expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions). Examples must also explain missing secrets on fork pull requests and avoid running untrusted PR code with API credentials. See [secure use reference](https://docs.github.com/en/actions/reference/security/secure-use).

## Candidate examples and validation

- Decide whether an issue describes a reproducible bug, using title/body context.
- Decide whether a PR description calls for migration documentation, using title/body context. This evaluates the description, not the unseen diff.
- Decide whether a supplied change summary describes user-visible behavior, for a release-note workflow.

Tests should cover true and false answers, threshold boundaries, low confidence, invalid inputs, malformed responses, authentication errors, rate limiting, server failures, and timeouts. Test output wiring through the bundled entrypoint. Keep default tests offline; a live smoke test and a small labeled evaluation set should be distinct from unit tests. Do not claim model accuracy or successful hosted execution without running them.

Before coding, settle the first example, context collection scope, confidence semantics, error/uncertainty policy, repository owner, license, and available Jev access.
