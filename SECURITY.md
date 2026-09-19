# Security

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Victor-Casado/if-ai/security/advisories/new). Do not put credentials or private source in a public issue.

The Action sends the selected PR body or diff and condition to TypeSafe, directly or through OpenRouter according to `provider`. The maintainer of if-ai does not receive that content. Review the selected provider's data terms before using it with private repositories. With OpenRouter, both OpenRouter and the model provider process the content.

PR content may try to manipulate a model's answer. A passing result is an advisory semantic judgment, not proof of safety, correctness, or permission to merge. Confidence is not an accuracy guarantee.

Use a trusted, pinned release of this Action. Never invoke an untrusted PR's local `./` Action with secrets, install its dependencies, or execute its scripts in a privileged job. In `pull_request_target` workflows, keep workflow logic and checkout on the base side. The fork example fetches the PR head as Git data only.

Public PRs can trigger paid API calls. Before enabling either `pull_request_target` example, create the `jev-approved` environment in repository settings, add a required maintainer reviewer, and store the selected provider's API key as an environment secret. The examples use `TYPESAFE_API_KEY`; for OpenRouter, also set `provider: openrouter` and reference `OPENROUTER_API_KEY` instead. Declaring an environment name in YAML does not add reviewers automatically. Approve the exact run you intend to fund. Repository-level approval for external contributors does not protect `pull_request_target` runs.

The Action requests no write permissions and makes no GitHub comments, reviews, or merges. Repository rules decide whether its job is required. A same-repository-only workflow skips fork PRs; use the documented fork workflow if they must be evaluated.

Supported releases: the latest 0.x release. Report reproducible problems against the exact version or commit used.
