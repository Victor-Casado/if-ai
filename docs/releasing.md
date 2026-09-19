# Release and validation

## Validation status

- Offline tests cover input validation, the Choice contract, all-file aggregation, concurrent requests, actual Git diffs, and the bundled Action's outputs and exit codes.
- [Hosted Linux and Windows CI passed](https://github.com/Victor-Casado/if-ai/actions/runs/35401282569).
- [Initial live Jev PR-body smoke test passed](https://github.com/Victor-Casado/if-ai/actions/runs/35427936662). The expanded three-mode test is pending. These are contract smoke tests, not model-accuracy evaluations.
- No model accuracy, latency, or cost benchmark is claimed.

## Release procedure

1. Run `npm ci` and `npm run check`. Commit source, lockfile, and regenerated `dist/` together.
2. Push and wait for both CI jobs to pass. Run the manual live smoke workflow if the TypeSafe secret is available.
3. Create an immutable version tag such as `v0.1.0`, and publish GitHub release notes describing behavior and validation limits.
4. Verify the README and examples refer to the released tag. Consumers can pin the release commit SHA.

GitHub Marketplace listing is optional and separate from a usable public Action release. Follow GitHub's publishing flow if listing it there. Do not claim a Marketplace listing until it exists.
