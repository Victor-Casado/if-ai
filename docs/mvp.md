# if-ai MVP

## Accepted requirements

- Open-source TypeScript GitHub Action using Jev, licensed under MIT.
- Users supply a plain-English condition and minimum confidence.
- Users select one of three input modes: PR body, entire diff, or diff evaluated per file in parallel.
- Per-file evaluations produce one GitHub check. Failures identify the affected files.
- Publish boolean and confidence outputs, with explicit handling of operational errors and uncertainty.
- Ship a strong README, useful workflow examples, and tests. Keep the scope small enough for immediate public release.
- The maintainer has TypeSafe API access. No credential has been supplied or live test run.

## Proposed implementation

- Input `mode`: `pr-body`, `diff`, or `per-file`; default `diff`.
- Inputs `condition`, `min-confidence`, and `api-key`.
- Use two-option Jev Choice to obtain a decision and native confidence.
- Diff modes use the PR event's exact head and base commits, comparing merge-base to head. Require a full-history checkout. PR-body mode requires no checkout.
- Evaluate every changed text file without silent truncation. Reject unsupported binary changes and oversized inputs explicitly.
- Bound per-file concurrency. Keep all evaluations inside the one Action step and job, without a workflow matrix or separate Checks API calls.
- Report per-file results in the job summary. Include file names in failure diagnostics; do not log diff contents or credentials.
- Pin the model version and validate responses. Use bounded requests and sanitized errors.
- Default tests run offline. Document live validation separately.

## Confirmed behavior

Every evaluated file must satisfy the condition and meet the user-supplied minimum confidence. A false answer, low confidence, or operational error fails the check. Both condition and min-confidence are required inputs, without implicit defaults.

The maintainer requested a new repository and frequent commits. The authenticated GitHub owner is Victor-Casado; the repository will be Victor-Casado/if-ai.

The earlier [research proposal](research/overlap-and-mvp.md) predates the accepted full-diff and per-file requirements. This document records the current scope.
