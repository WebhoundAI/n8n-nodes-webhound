# Contributing

## Local checks

Use Node.js 22.22.0 or newer, then run:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --dry-run
```

Do not use a real `WEBHOUND_KEY` in tests, fixtures, screenshots, issues, or commits.

## Community-node release path

This package is intended to remain an independent n8n community-node repository rather than a pull request to the main n8n monorepo.

1. Create the public `WebhoundAI/n8n-nodes-webhound` repository so it matches `package.json`.
2. Push reviewed source without credentials.
3. Configure npm trusted publishing for `.github/workflows/publish.yml`.
4. Tag a release. The workflow publishes with npm provenance, as required for community nodes from May 1, 2026.
5. Run n8n's community package scanner against the published package.
6. Test installation and all actions in a clean supported n8n instance with a test Webhound account.
7. Submit the package through the [n8n Creator Portal](https://creators.n8n.io/nodes).

Publication, repository creation, and Creator Portal submission require explicit release-owner approval.
