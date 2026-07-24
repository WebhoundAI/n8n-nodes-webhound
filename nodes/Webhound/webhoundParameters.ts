import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { WebhoundOperation } from './webhound.constants';

export interface PreparedWebhoundCall {
	toolName: string;
	arguments: IDataObject;
	spendBearing: boolean;
}

export { NodeOperationError as WebhoundInputError };

function requiredString(
	parameters: Readonly<Record<string, unknown>>,
	name: string,
	node: INode,
	minimumLength = 1,
): string {
	const value = String(parameters[name] ?? '').trim();
	if (value.length < minimumLength) {
		throw new NodeOperationError(
			node,
			`${name} is required and must contain at least ${minimumLength} characters.`,
		);
	}
	return value;
}

function optionalString(
	parameters: Readonly<Record<string, unknown>>,
	name: string,
): string | undefined {
	const value = String(parameters[name] ?? '').trim();
	return value || undefined;
}

function requiredBudget(
	parameters: Readonly<Record<string, unknown>>,
	node: INode,
): number {
	const value = parameters.budget;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new NodeOperationError(
			node,
			'budget is required and must be a dollar amount from 1 to 500.',
		);
	}
	if (value < 1 || value > 500) {
		throw new NodeOperationError(node, 'budget must be between $1 and $500.');
	}
	return value;
}

function requireSpendConfirmation(
	parameters: Readonly<Record<string, unknown>>,
	node: INode,
): void {
	if (parameters.confirm_spend !== true) {
		throw new NodeOperationError(
			node,
			'This action can start spend. Set confirm_spend=true only after approving the displayed dollar budget.',
		);
	}
}

function optionalBoolean(
	parameters: Readonly<Record<string, unknown>>,
	name: string,
	defaultValue: boolean,
): boolean {
	const value = parameters[name];
	return typeof value === 'boolean' ? value : defaultValue;
}

function optionalDatasetSchema(
	parameters: Readonly<Record<string, unknown>>,
	node: INode,
): IDataObject | undefined {
	const raw = optionalString(parameters, 'schemaJson');
	if (!raw) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const detail = error instanceof SyntaxError ? error.message : 'invalid JSON';
		throw new NodeOperationError(
			node,
			`schemaJson must contain valid JSON: ${detail}`,
		);
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new NodeOperationError(node, 'schemaJson must decode to a JSON object.');
	}

	return parsed as IDataObject;
}

function setIfDefined(target: IDataObject, name: string, value: unknown): void {
	if (value !== undefined && value !== '') {
		target[name] = value as IDataObject[string];
	}
}

function startReport(
	parameters: Readonly<Record<string, unknown>>,
	node: INode,
): PreparedWebhoundCall {
	requireSpendConfirmation(parameters, node);
	const argumentsValue: IDataObject = {
		prompt: requiredString(parameters, 'prompt', node, 8),
		budget: requiredBudget(parameters, node),
		enable_checkpoints: optionalBoolean(parameters, 'enableCheckpoints', false),
		use_free_run_when_available: optionalBoolean(parameters, 'useFreeRunWhenAvailable', true),
	};
	setIfDefined(argumentsValue, 'title', optionalString(parameters, 'title'));
	setIfDefined(
		argumentsValue,
		'output_instructions',
		optionalString(parameters, 'outputInstructions'),
	);
	return {
		toolName: 'webhound_start_report',
		arguments: argumentsValue,
		spendBearing: true,
	};
}

function startDataset(
	parameters: Readonly<Record<string, unknown>>,
	node: INode,
): PreparedWebhoundCall {
	requireSpendConfirmation(parameters, node);
	const argumentsValue: IDataObject = {
		prompt: requiredString(parameters, 'prompt', node, 8),
		budget: requiredBudget(parameters, node),
		enable_checkpoints: optionalBoolean(parameters, 'enableCheckpoints', false),
		use_free_run_when_available: optionalBoolean(parameters, 'useFreeRunWhenAvailable', true),
	};
	setIfDefined(argumentsValue, 'schema', optionalDatasetSchema(parameters, node));
	setIfDefined(argumentsValue, 'title', optionalString(parameters, 'title'));
	return {
		toolName: 'webhound_start_dataset',
		arguments: argumentsValue,
		spendBearing: true,
	};
}

function watchWait(
	parameters: Readonly<Record<string, unknown>>,
	node: INode,
): PreparedWebhoundCall {
	const sessionId = requiredString(parameters, 'sessionId', node);
	const rawWaitSeconds = parameters.waitSeconds;
	if (
		typeof rawWaitSeconds !== 'number' ||
		!Number.isInteger(rawWaitSeconds) ||
		rawWaitSeconds < 0 ||
		rawWaitSeconds > 110
	) {
		throw new NodeOperationError(
			node,
			'waitSeconds must be a whole number from 0 to 110.',
		);
	}
	if (rawWaitSeconds === 0) {
		return {
			toolName: 'webhound_watch',
			arguments: { session_id: sessionId },
			spendBearing: false,
		};
	}

	const rawPollInterval = parameters.pollIntervalSeconds;
	if (
		typeof rawPollInterval !== 'number' ||
		!Number.isInteger(rawPollInterval) ||
		rawPollInterval < 3 ||
		rawPollInterval > 30
	) {
		throw new NodeOperationError(
			node,
			'pollIntervalSeconds must be a whole number from 3 to 30.',
		);
	}
	return {
		toolName: 'webhound_wait',
		arguments: {
			session_id: sessionId,
			max_wait_seconds: rawWaitSeconds,
			poll_interval_seconds: rawPollInterval,
		},
		spendBearing: false,
	};
}

function getOutput(
	parameters: Readonly<Record<string, unknown>>,
	node: INode,
): PreparedWebhoundCall {
	const argumentsValue: IDataObject = {
		session_id: requiredString(parameters, 'sessionId', node),
		kind: String(parameters.kind || 'auto'),
		select: String(parameters.select || 'output'),
		allow_partial: optionalBoolean(parameters, 'allowPartial', false),
	};
	setIfDefined(argumentsValue, 'doc_name', optionalString(parameters, 'documentName'));
	return {
		toolName: 'webhound_get_output',
		arguments: argumentsValue,
		spendBearing: false,
	};
}

function getEvidencePack(
	parameters: Readonly<Record<string, unknown>>,
	node: INode,
): PreparedWebhoundCall {
	return {
		toolName: 'webhound_get_evidence_pack',
		arguments: {
			session_id: requiredString(parameters, 'sessionId', node),
			kind: String(parameters.kind || 'auto'),
			include_working_docs: optionalBoolean(parameters, 'includeWorkingDocs', true),
			include_claims: optionalBoolean(parameters, 'includeClaims', true),
			include_sources: optionalBoolean(parameters, 'includeSources', true),
			allow_partial: optionalBoolean(parameters, 'allowPartial', false),
		},
		spendBearing: false,
	};
}

function help(parameters: Readonly<Record<string, unknown>>): PreparedWebhoundCall {
	const argumentsValue: IDataObject = {
		topic: String(parameters.topic || 'overview'),
	};
	setIfDefined(argumentsValue, 'question', optionalString(parameters, 'question'));
	return {
		toolName: 'webhound_help',
		arguments: argumentsValue,
		spendBearing: false,
	};
}

export function prepareWebhoundCall(
	operation: WebhoundOperation,
	parameters: Readonly<Record<string, unknown>>,
	node: INode,
): PreparedWebhoundCall {
	switch (operation) {
		case 'startReport':
			return startReport(parameters, node);
		case 'startDataset':
			return startDataset(parameters, node);
		case 'watchWait':
			return watchWait(parameters, node);
		case 'getOutput':
			return getOutput(parameters, node);
		case 'getEvidencePack':
			return getEvidencePack(parameters, node);
		case 'account':
			return {
				toolName: 'webhound_account',
				arguments: {},
				spendBearing: false,
			};
		case 'help':
			return help(parameters);
	}
}
