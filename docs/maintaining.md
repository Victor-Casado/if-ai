# Maintaining if-ai

## Repository settings

Main requires a pull request, up-to-date Linux and Windows CI, and resolved conversations. CodeQL results must have no open high-severity security findings or errors. Direct pushes, force pushes, and deletion are blocked, including for the owner. Squash merge is the only merge method.

This is a single-maintainer repository. A second approval is not required because authors cannot approve their own PRs. CODEOWNERS routes incoming changes to the maintainer. Add required approvals when another maintainer joins.

Release tags matching `v*` cannot be moved or deleted. Only repository administrators may create them. GitHub immutable releases protect new published releases. Fix a released bug with a new patch version.

Keep these protections enabled:

- Read-only default workflow token; Actions cannot approve PRs.
- Full-SHA action references, with only GitHub-owned actions allowed.
- Approval before running external contributors' workflows.
- Secret scanning and push protection, Dependabot alerts and security updates, CodeQL, and private vulnerability reporting.

Dependabot proposes weekly npm and Actions updates. Rebuild `dist/` before merging dependency changes. Do not auto-merge changes to the code consumers execute.

Keep `@types/node` on major 24 while the Action uses Node 24. Dependabot ignores major updates for that package; change the runtime and types together.

## Publish a release

1. Update the version in `package.json`, the lockfile, README, and examples on a branch.
2. Run `npm ci` and `npm run check`. Commit the rebuilt bundle.
3. Merge the PR after its checks pass. Run the manual **Live Jev smoke test** on main when the change affects evaluation. Select each affected provider. It uses `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` from repository secrets.
4. Tag that checked commit with the exact version, such as `v0.1.1`, and push the tag.
5. Publish release notes on GitHub. Describe user-visible changes, tests, and known limits. Do not claim model accuracy from smoke tests.

Do not retag an existing release. Consumers can use an exact version or its full commit SHA.

The Marketplace listing name in `action.yml` is `if-ai PR Check`, not `if-ai`. Marketplace names must be unique across every action, user, and organization, and the GitHub user `if-ai` already exists. The repository name and the `uses:` path are unaffected.

GitHub releases are the changelog. The repository does not keep a second copy of release notes. A Marketplace listing is optional and separate from publishing a usable Action.
