# Changelog

## 0.1.2

- Replace custom input and transport error classes with n8n-native `NodeOperationError` instances.
- Preserve credential redaction, one-request spend behavior, item context, and user-facing error messages.
- Run n8n's community package scanner in CI before future releases.

## 0.1.1

- Publish from GitHub Actions through npm Trusted Publishing with provenance.
- Exclude the TypeScript incremental build cache from the package.

## 0.1.0

- Add user-owned `WEBHOUND_KEY` credentials against the fixed hosted Webhound MCP endpoint.
- Add report and dataset starts with explicit budget and spend confirmation.
- Add Watch / Wait, Get Output, Get Evidence Pack, Account, and Help actions.
- Add Streamable HTTP response parsing, safe errors, tests, and release workflows.
