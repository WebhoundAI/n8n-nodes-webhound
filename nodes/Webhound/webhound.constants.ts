export const WEBHOUND_MCP_ENDPOINT = 'https://api.webhound.ai/api/v2/mcp';
export const WEBHOUND_MCP_PROTOCOL_VERSION = '2025-06-18';
export const WEBHOUND_PACKAGE_VERSION = '0.1.2';
export const WEBHOUND_REQUEST_TIMEOUT_MS = 125_000;

export const WEBHOUND_OPERATIONS = [
	'startReport',
	'startDataset',
	'watchWait',
	'getOutput',
	'getEvidencePack',
	'account',
	'help',
] as const;

export type WebhoundOperation = (typeof WEBHOUND_OPERATIONS)[number];

export const WEBHOUND_HELP_TOPICS = [
	'overview',
	'hound',
	'when_to_use',
	'budget',
	'completion',
	'reports',
	'datasets',
	'sources_and_claims',
	'files',
	'exports',
	'billing',
	'free_run',
	'troubleshooting',
	'onboarding',
	'mcp_setup',
] as const;
