import assert from 'node:assert/strict';
import test from 'node:test';

import { Webhound } from '../dist/nodes/Webhound/Webhound.node.js';
import {
	WEBHOUND_MCP_ENDPOINT,
	WEBHOUND_OPERATIONS,
} from '../dist/nodes/Webhound/webhound.constants.js';
import {
	prepareWebhoundCall,
	WebhoundInputError,
} from '../dist/nodes/Webhound/webhoundParameters.js';
import {
	extractToolResult,
	parseMcpEnvelope,
	parseSseEnvelope,
	redactSecret,
} from '../dist/nodes/Webhound/webhoundTransport.js';
import { WebhoundApi } from '../dist/credentials/WebhoundApi.credentials.js';

function sseToolResponse(id, structuredContent, summary = 'Completed.') {
	const envelope = {
		jsonrpc: '2.0',
		id,
		result: {
			content: [{ type: 'text', text: summary }],
			structuredContent,
			isError: false,
		},
	};
	return {
		body: `event: message\ndata: ${JSON.stringify(envelope)}\n\n`,
		headers: { 'content-type': 'text/event-stream; charset=utf-8' },
		statusCode: 200,
	};
}

function createExecutionContext({
	operation = 'account',
	parameters = {},
	response,
	secret = 'wh_test_user',
	continueOnFail = false,
	inputItems = [{ json: { input: true } }],
}) {
	let requestCount = 0;
	let seenRequest;
	const values = { operation, ...parameters };
	const context = {
		getInputData: () => inputItems,
		getCredentials: async () => ({ webhoundKey: secret }),
		getNodeParameter: (name, _itemIndex, fallback) =>
			Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback,
		getNode: () => ({ name: 'Webhound', type: 'webhound', typeVersion: 1, position: [0, 0] }),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequest: async (options) => {
				requestCount += 1;
				seenRequest = options;
				if (response instanceof Error) throw response;
				return typeof response === 'function' ? response(options) : response;
			},
		},
	};
	return {
		context,
		get requestCount() {
			return requestCount;
		},
		get seenRequest() {
			return seenRequest;
		},
	};
}

test('package exposes exactly the requested native actions', () => {
	assert.deepEqual(WEBHOUND_OPERATIONS, [
		'startReport',
		'startDataset',
		'watchWait',
		'getOutput',
		'getEvidencePack',
		'account',
		'help',
	]);
	const node = new Webhound();
	assert.equal(node.description.name, 'webhound');
	assert.equal(node.description.credentials[0].name, 'webhoundApi');
	const operations = node.description.properties.find(({ name }) => name === 'operation');
	assert.deepEqual(
		operations.options.map(({ value }) => value),
		WEBHOUND_OPERATIONS,
	);
	const budget = node.description.properties.find(({ name }) => name === 'budget');
	assert.equal(budget.default, 0);
	assert.equal(budget.noDataExpression, true);
});

test('credentials contain one user key and a fixed MCP endpoint', () => {
	const credential = new WebhoundApi();
	assert.equal(credential.properties.length, 1);
	assert.equal(credential.properties[0].displayName, 'WEBHOUND_KEY');
	assert.equal(credential.properties[0].typeOptions.password, true);
	assert.equal(credential.test.request.url, WEBHOUND_MCP_ENDPOINT);
	assert.equal(credential.test.request.disableFollowRedirect, true);
	assert.equal(credential.test.request.sendCredentialsOnCrossOriginRedirect, false);
	assert.equal(credential.authenticate, undefined);
	assert.equal(
		credential.test.request.headers.Authorization.includes('webhoundKey'),
		true,
	);
});

test('start report requires explicit spend confirmation before any request', async () => {
	const execution = createExecutionContext({
		operation: 'startReport',
		parameters: {
			prompt: 'Compare two markets using primary sources.',
			budget: 5,
			confirm_spend: false,
			title: '',
			outputInstructions: '',
			enableCheckpoints: false,
			useFreeRunWhenAvailable: true,
		},
		response: new Error('The network must not be called.'),
	});

	await assert.rejects(
		Webhound.prototype.execute.call(execution.context),
		/confirm_spend=true/,
	);
	assert.equal(execution.requestCount, 0);
});

test('start report requires an explicitly entered dollar budget before any request', async () => {
	const execution = createExecutionContext({
		operation: 'startReport',
		parameters: {
			prompt: 'Compare two markets using primary sources.',
			budget: 0,
			confirm_spend: true,
			title: '',
			outputInstructions: '',
			enableCheckpoints: false,
			useFreeRunWhenAvailable: true,
		},
		response: new Error('The network must not be called.'),
	});

	await assert.rejects(Webhound.prototype.execute.call(execution.context), /between \$1 and \$500/);
	assert.equal(execution.requestCount, 0);
});

test('one spend confirmation cannot multiply across input items', async () => {
	const execution = createExecutionContext({
		operation: 'startReport',
		inputItems: [{ json: { first: true } }, { json: { second: true } }],
		parameters: {
			prompt: 'Compare two markets using primary sources.',
			budget: 5,
			confirm_spend: true,
			title: '',
			outputInstructions: '',
			enableCheckpoints: false,
			useFreeRunWhenAvailable: true,
		},
		response: new Error('The network must not be called.'),
	});

	await assert.rejects(
		Webhound.prototype.execute.call(execution.context),
		/require exactly one input item/,
	);
	assert.equal(execution.requestCount, 0);
});

test('start report sends budget once and removes local confirmation', async () => {
	const execution = createExecutionContext({
		operation: 'startReport',
		parameters: {
			prompt: 'Compare two markets using primary sources.',
			budget: 5,
			confirm_spend: true,
			title: 'Market comparison',
			outputInstructions: '',
			enableCheckpoints: false,
			useFreeRunWhenAvailable: true,
		},
		response: (options) =>
			sseToolResponse(options.body.id, {
				session_id: 'report-123',
				url: 'https://www.webhound.ai/session/report-123',
			}),
	});

	const [items] = await Webhound.prototype.execute.call(execution.context);
	assert.equal(execution.requestCount, 1);
	assert.equal(execution.seenRequest.url, WEBHOUND_MCP_ENDPOINT);
	assert.equal(execution.seenRequest.disableFollowRedirect, true);
	assert.equal(execution.seenRequest.headers.Authorization, 'Bearer wh_test_user');
	assert.equal(
		execution.seenRequest.body.params.name,
		'webhound_start_report',
	);
	assert.deepEqual(execution.seenRequest.body.params.arguments, {
		prompt: 'Compare two markets using primary sources.',
		budget: 5,
		enable_checkpoints: false,
		use_free_run_when_available: true,
		title: 'Market comparison',
	});
	assert.equal('confirm_spend' in execution.seenRequest.body.params.arguments, false);
	assert.equal('model' in execution.seenRequest.body.params.arguments, false);
	assert.equal('mode' in execution.seenRequest.body.params.arguments, false);
	assert.equal('default_model' in execution.seenRequest.body.params.arguments, false);
	assert.equal(items[0].json.session_id, 'report-123');
	assert.equal(items[0].json.mcp_summary, 'Completed.');
});

test('failed spend start makes one request and returns a safe error', async () => {
	const secret = 'wh_test_never_log';
	const execution = createExecutionContext({
		operation: 'startDataset',
		secret,
		parameters: {
			prompt: 'Build a sourced list of ten companies.',
			budget: 5,
			confirm_spend: true,
			title: '',
			schemaJson: '',
			enableCheckpoints: false,
			useFreeRunWhenAvailable: true,
		},
		response: new Error(`upstream echoed ${secret}`),
	});

	await assert.rejects(
		Webhound.prototype.execute.call(execution.context),
		/The request was not retried/,
	);
	assert.equal(execution.requestCount, 1);
});

test('dataset schema is parsed and mapped without retired fields', () => {
	const prepared = prepareWebhoundCall('startDataset', {
		prompt: 'Build a sourced list of ten companies.',
		budget: 7.5,
		confirm_spend: true,
		schemaJson: '{"company":{"type":"string"}}',
		enableCheckpoints: true,
		useFreeRunWhenAvailable: false,
	});
	assert.equal(prepared.toolName, 'webhound_start_dataset');
	assert.deepEqual(prepared.arguments.schema, { company: { type: 'string' } });
	assert.equal(prepared.arguments.budget, 7.5);
	for (const retired of ['model', 'mode', 'default_model', 'confirm_spend']) {
		assert.equal(retired in prepared.arguments, false);
	}
});

test('invalid dataset schema is rejected locally', () => {
	assert.throws(
		() =>
			prepareWebhoundCall('startDataset', {
				prompt: 'Build a sourced list of ten companies.',
				budget: 5,
				confirm_spend: true,
				schemaJson: '{not-json}',
			}),
		(error) =>
			error instanceof WebhoundInputError && /valid JSON/.test(error.message),
	);
});

test('watch maps zero to watch and a bounded wait to wait', () => {
	assert.deepEqual(
		prepareWebhoundCall('watchWait', {
			sessionId: 'session-123',
			waitSeconds: 0,
			pollIntervalSeconds: 10,
		}),
		{
			toolName: 'webhound_watch',
			arguments: { session_id: 'session-123' },
			spendBearing: false,
		},
	);
	assert.deepEqual(
		prepareWebhoundCall('watchWait', {
			sessionId: 'session-123',
			waitSeconds: 60,
			pollIntervalSeconds: 10,
		}),
		{
			toolName: 'webhound_wait',
			arguments: {
				session_id: 'session-123',
				max_wait_seconds: 60,
				poll_interval_seconds: 10,
			},
			spendBearing: false,
		},
	);
});

test('SSE and JSON responses preserve done as the authoritative field', () => {
	const id = 'request-1';
	const structured = {
		status: 'researching',
		done: false,
		output_ready: true,
	};
	const sse = `event: ping\ndata: {"kind":"progress"}\n\nevent: message\ndata: ${JSON.stringify({
		jsonrpc: '2.0',
		id,
		result: {
			content: [{ type: 'text', text: 'Still running.' }],
			structuredContent: structured,
		},
	})}\n\n`;
	const envelope = parseSseEnvelope(sse);
	const result = extractToolResult(envelope, id, 'wh_test', 'webhound_watch');
	assert.equal(result.structuredContent.done, false);
	assert.equal(result.structuredContent.output_ready, true);
	assert.equal(result.summary, 'Still running.');
	assert.deepEqual(parseMcpEnvelope(JSON.stringify(envelope)), envelope);
});

test('response errors redact WEBHOUND_KEY', () => {
	const secret = 'wh_test_never_log';
	assert.equal(redactSecret(`bad ${secret}`, secret), 'bad [REDACTED]');
	assert.throws(
		() =>
			extractToolResult(
				{
					jsonrpc: '2.0',
					id: 'request-1',
					error: { code: -32000, message: `upstream echoed ${secret}` },
				},
				'request-1',
				secret,
				'webhound_account',
			),
		(error) =>
			!error.message.includes(secret) && error.message.includes('[REDACTED]'),
	);
});

test('read actions map to the expected MCP tools', () => {
	assert.equal(prepareWebhoundCall('account', {}).toolName, 'webhound_account');
	assert.equal(
		prepareWebhoundCall('getOutput', {
			sessionId: 'session-123',
			kind: 'auto',
			select: 'output',
			allowPartial: false,
		}).toolName,
		'webhound_get_output',
	);
	assert.equal(
		prepareWebhoundCall('getEvidencePack', {
			sessionId: 'session-123',
			kind: 'auto',
			includeWorkingDocs: true,
			includeClaims: true,
			includeSources: true,
			allowPartial: false,
		}).toolName,
		'webhound_get_evidence_pack',
	);
	assert.equal(
		prepareWebhoundCall('help', {
			topic: 'budget',
			question: 'How does budget define effort?',
		}).toolName,
		'webhound_help',
	);
});
