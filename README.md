# n8n-nodes-webhound

This is an n8n community node for Webhound. It starts private reports and datasets with an explicit research budget, waits for truthful completion, and returns either the polished result or the evidence behind it.

Webhound is for questions where the amount of research matters. The dollar budget is part of the task: it controls effort and caps financial exposure. `done=true` is the authoritative completion signal. `output_ready=true` by itself may still describe an intermediate artifact.

Hound is a research harness built with DeepSeek V4 Pro and GPT-5.4 across planning, execution, verification, and assembly. It is not a selectable model or a direct pass-through.

## Installation

Install `n8n-nodes-webhound` through **Settings → Community Nodes** in a supported n8n instance. For local development:

```sh
pnpm install
pnpm dev
```

The development command builds the node, loads it into a local n8n instance, and watches for changes.

## Credentials

Every n8n user or workspace supplies its own `WEBHOUND_KEY`.

1. Create a Webhound API key at [webhound.ai/api](https://www.webhound.ai/api).
2. In n8n, create a **Webhound API** credential.
3. Paste the key into `WEBHOUND_KEY` and run the credential test.

n8n encrypts saved credentials. This node:

- calls only `https://api.webhound.ai/api/v2/mcp`;
- does not accept a configurable endpoint or a publisher-owned key;
- does not expose n8n's generic Custom API Call proxy;
- does not read environment variables or files;
- never writes the key to output or logs;
- rejects redirects so the credential is not forwarded to another host.

## Operations

### Start Report

Starts a private cited report. Required inputs:

- **Research Prompt**: the question, scope, constraints, and desired artifact;
- **Maximum Budget (USD)**: an explicit amount from $1 to $500;
- **Confirm Spend**: must be set manually to `true` after the exact budget is approved.

The confirmation is a local guard and is removed before the MCP request. A rejected or unavailable start receives one request only; this node has no automatic retry loop.
Spend-bearing starts accept exactly one input item, so one confirmation cannot multiply the approved budget across a batch.

### Start Dataset

Starts a private sourced dataset. It has the same budget and confirmation gate as Start Report. An optional JSON object can describe requested fields.

### Watch / Wait

Use a zero-second wait for one immediate `webhound_watch` call. Use 1-110 seconds for one bounded `webhound_wait` call. Healthy budgeted research can run for a long time. Follow the returned check-in guidance and keep waiting until `done=true`.

### Get Output

Returns the complete report output, a selected report document, or dataset rows. Leave **Allow Partial** off unless someone explicitly asked for an interim snapshot.

### Get Evidence Pack

Returns the final output plus working documents, claim traces, and sources. Use this for diligence, critique, decisions, or other work where the investigation matters as much as the final prose.

### Account

Returns credits, recent usage, free-run status, and current account defaults without spend.

### Help

Returns current Webhound guidance for budgets, completion, reports, datasets, evidence, billing, setup, and troubleshooting without spend.

## Workflow pattern

1. Use **Start Report** or **Start Dataset** with the approved dollar budget.
2. Store the returned `session_id`.
3. Schedule **Watch / Wait** based on `runtime_estimate.recommended_next_check_seconds`.
4. Continue until `done` is `true`.
5. Use **Get Output** for the finished artifact or **Get Evidence Pack** for the full research trail.

Avoid a tight polling loop. A normal long-running session is expected to return `done=false` many times.

## Output

The node returns Webhound's structured response as the n8n item JSON and adds `mcp_summary`, the concise text returned by the MCP tool. Alerts, budget progress, runtime estimates, sources, claims, rows, and documents remain available in their original structured fields.

## Compatibility

- Development and CI: Node.js 22.22.0
- n8n node API: 1
- Package style: current `@n8n/node-cli`
- Transport: stateless MCP Streamable HTTP, protocol version `2025-06-18`

## Development

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm audit --audit-level high
pnpm pack --dry-run
```

No live Webhound key is required by the unit tests. They use mocked n8n request helpers and assert that secrets are redacted, redirects are rejected, spend confirmation is checked before the network, and failed starts are not retried.

## Resources

- [Webhound](https://www.webhound.ai)
- [Webhound API keys](https://www.webhound.ai/api)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)
- [n8n node development](https://docs.n8n.io/connect/create-nodes/)

## Version history

- `0.1.1`: provenance release via npm trusted publishing; excludes the TypeScript build cache from the package.
- `0.1.0`: initial report, dataset, watch/wait, output, evidence, account, and help actions.
