import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	WEBHOUND_HELP_TOPICS,
	WEBHOUND_OPERATIONS,
	type WebhoundOperation,
} from './webhound.constants';
import { prepareWebhoundCall, WebhoundInputError } from './webhoundParameters';
import {
	callWebhoundTool,
	redactSecret,
	WebhoundTransportError,
} from './webhoundTransport';

const operationOptions: INodeProperties['options'] = [
	{
		name: 'Start Report',
		value: 'startReport',
		description: 'Start a private, long-running cited report',
		action: 'Start a report',
	},
	{
		name: 'Start Dataset',
		value: 'startDataset',
		description: 'Start a private, long-running sourced dataset',
		action: 'Start a dataset',
	},
	{
		name: 'Watch / Wait',
		value: 'watchWait',
		description: 'Check immediately or perform one bounded wait',
		action: 'Watch or wait for a session',
	},
	{
		name: 'Get Output',
		value: 'getOutput',
		description: 'Retrieve the report output or dataset rows',
		action: 'Get session output',
	},
	{
		name: 'Get Evidence Pack',
		value: 'getEvidencePack',
		description: 'Retrieve final output, working documents, claims, and sources',
		action: 'Get an evidence pack',
	},
	{
		name: 'Account',
		value: 'account',
		description: 'Read credits, usage, free-run status, and defaults without spend',
		action: 'Get account status',
	},
	{
		name: 'Help',
		value: 'help',
		description: 'Get current Webhound guidance without spend',
		action: 'Get help',
	},
];

const helpTopicOptions: INodeProperties['options'] = WEBHOUND_HELP_TOPICS.map((topic) => ({
	name: topic
		.split('_')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' '),
	value: topic,
}));

function isSpendStart(operation: string): boolean {
	return operation === 'startReport' || operation === 'startDataset';
}

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: operationOptions,
		default: 'startReport',
	},
	{
		displayName:
			'Hound is a research harness built with DeepSeek V4 Pro and GPT-5.4 across planning, execution, verification, and assembly. It is not a selectable model or a direct pass-through.',
		name: 'houndNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				operation: ['startReport', 'startDataset'],
			},
		},
	},
	{
		displayName: 'Research Prompt',
		name: 'prompt',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		required: true,
		placeholder: 'Compare the leading vendors, verify pricing, and cite primary sources.',
		description:
			'The question, scope, constraints, and desired artifact. Must contain at least 8 characters.',
		displayOptions: {
			show: {
				operation: ['startReport', 'startDataset'],
			},
		},
	},
	{
		displayName: 'Maximum Budget (USD)',
		name: 'budget',
		type: 'number',
		noDataExpression: true,
		typeOptions: {
			minValue: 1,
			maxValue: 500,
			numberPrecision: 2,
		},
		default: 0,
		required: true,
		description:
			'Enter the explicit dollar cap for this investigation. Budget controls effort and caps financial exposure.',
		displayOptions: {
			show: {
				operation: ['startReport', 'startDataset'],
			},
		},
	},
	{
		displayName: 'Confirm Spend',
		name: 'confirm_spend',
		type: 'boolean',
		noDataExpression: true,
		default: false,
		required: true,
		description:
			'Whether the exact dollar budget above has been approved. Leave false until approval; the node rejects the action before any request when false.',
		displayOptions: {
			show: {
				operation: ['startReport', 'startDataset'],
			},
		},
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		placeholder: 'Vendor pricing and evidence review',
		description: 'Optional private session title',
		displayOptions: {
			show: {
				operation: ['startReport', 'startDataset'],
			},
		},
	},
	{
		displayName: 'Output Instructions',
		name: 'outputInstructions',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'Optional report structure, audience, tone, or format requirements',
		displayOptions: {
			show: {
				operation: ['startReport'],
			},
		},
	},
	{
		displayName: 'Dataset Schema (JSON)',
		name: 'schemaJson',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		placeholder: '{"company":{"type":"string"},"source_url":{"type":"string"}}',
		description: 'Optional JSON object describing the requested fields and their requirements',
		displayOptions: {
			show: {
				operation: ['startDataset'],
			},
		},
	},
	{
		displayName: 'Enable Checkpoints',
		name: 'enableCheckpoints',
		type: 'boolean',
		default: false,
		description: 'Whether Webhound may pause for user input when a checkpoint is needed',
		displayOptions: {
			show: {
				operation: ['startReport', 'startDataset'],
			},
		},
	},
	{
		displayName: 'Use Included First Run When Available',
		name: 'useFreeRunWhenAvailable',
		type: 'boolean',
		default: true,
		description:
			'Whether to prefer this user account’s included first run when it is available',
		displayOptions: {
			show: {
				operation: ['startReport', 'startDataset'],
			},
		},
	},
	{
		displayName: 'Session ID',
		name: 'sessionId',
		type: 'string',
		default: '',
		required: true,
		description: 'The session identifier returned by Start Report or Start Dataset',
		displayOptions: {
			show: {
				operation: ['watchWait', 'getOutput', 'getEvidencePack'],
			},
		},
	},
	{
		displayName: 'Bounded Wait (Seconds)',
		name: 'waitSeconds',
		type: 'number',
		typeOptions: {
			minValue: 0,
			maxValue: 110,
			numberPrecision: 0,
		},
		default: 0,
		description:
			'Use 0 for an immediate watch. Use 1-110 for one bounded server-side wait; do not poll continuously.',
		displayOptions: {
			show: {
				operation: ['watchWait'],
			},
		},
	},
	{
		displayName: 'Poll Interval (Seconds)',
		name: 'pollIntervalSeconds',
		type: 'number',
		typeOptions: {
			minValue: 3,
			maxValue: 30,
			numberPrecision: 0,
		},
		default: 10,
		description: 'Interval used by the server only during a bounded wait',
		displayOptions: {
			show: {
				operation: ['watchWait'],
			},
		},
	},
	{
		displayName: 'Kind',
		name: 'kind',
		type: 'options',
		options: [
			{ name: 'Auto', value: 'auto' },
			{ name: 'Report', value: 'report' },
			{ name: 'Dataset', value: 'dataset' },
		],
		default: 'auto',
		description: 'The expected session output type',
		displayOptions: {
			show: {
				operation: ['getOutput', 'getEvidencePack'],
			},
		},
	},
	{
		displayName: 'Select',
		name: 'select',
		type: 'options',
		options: [
			{ name: 'Output', value: 'output' },
			{ name: 'Working', value: 'working' },
			{ name: 'Latest', value: 'latest' },
		],
		default: 'output',
		description: 'Which document surface to retrieve for a report',
		displayOptions: {
			show: {
				operation: ['getOutput'],
			},
		},
	},
	{
		displayName: 'Document Name',
		name: 'documentName',
		type: 'string',
		default: '',
		description: 'Optional exact report document name',
		displayOptions: {
			show: {
				operation: ['getOutput'],
			},
		},
	},
	{
		displayName: 'Include Working Documents',
		name: 'includeWorkingDocs',
		type: 'boolean',
		default: true,
		description: 'Whether to include working documents in the evidence pack',
		displayOptions: {
			show: {
				operation: ['getEvidencePack'],
			},
		},
	},
	{
		displayName: 'Include Claims',
		name: 'includeClaims',
		type: 'boolean',
		default: true,
		description: 'Whether to include claim traces in the evidence pack',
		displayOptions: {
			show: {
				operation: ['getEvidencePack'],
			},
		},
	},
	{
		displayName: 'Include Sources',
		name: 'includeSources',
		type: 'boolean',
		default: true,
		description: 'Whether to include sources in the evidence pack',
		displayOptions: {
			show: {
				operation: ['getEvidencePack'],
			},
		},
	},
	{
		displayName: 'Allow Partial',
		name: 'allowPartial',
		type: 'boolean',
		default: false,
		description:
			'Whether to allow an interim snapshot before done=true. Enable only when a partial update was explicitly requested.',
		displayOptions: {
			show: {
				operation: ['getOutput', 'getEvidencePack'],
			},
		},
	},
	{
		displayName: 'Topic',
		name: 'topic',
		type: 'options',
		options: helpTopicOptions,
		default: 'overview',
		description: 'The Webhound help topic',
		displayOptions: {
			show: {
				operation: ['help'],
			},
		},
	},
	{
		displayName: 'Question',
		name: 'question',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'Optional specific Webhound question, up to 1,000 characters',
		displayOptions: {
			show: {
				operation: ['help'],
			},
		},
	},
];

function operationParameters(
	context: IExecuteFunctions,
	operation: WebhoundOperation,
	itemIndex: number,
): Record<string, unknown> {
	const namesByOperation: Record<WebhoundOperation, readonly string[]> = {
		startReport: [
			'prompt',
			'budget',
			'confirm_spend',
			'title',
			'outputInstructions',
			'enableCheckpoints',
			'useFreeRunWhenAvailable',
		],
		startDataset: [
			'prompt',
			'budget',
			'confirm_spend',
			'title',
			'schemaJson',
			'enableCheckpoints',
			'useFreeRunWhenAvailable',
		],
		watchWait: ['sessionId', 'waitSeconds', 'pollIntervalSeconds'],
		getOutput: ['sessionId', 'kind', 'select', 'documentName', 'allowPartial'],
		getEvidencePack: [
			'sessionId',
			'kind',
			'includeWorkingDocs',
			'includeClaims',
			'includeSources',
			'allowPartial',
		],
		account: [],
		help: ['topic', 'question'],
	};

	return Object.fromEntries(
		namesByOperation[operation].map((name) => [
			name,
			context.getNodeParameter(name, itemIndex),
		]),
	);
}

function safeErrorMessage(error: unknown, secret: string): string {
	const fallback = 'Webhound action failed.';
	const message =
		error instanceof WebhoundInputError || error instanceof WebhoundTransportError
			? error.message
			: fallback;
	return redactSecret(message, secret).slice(0, 1_000);
}

export class Webhound implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Webhound',
		name: 'webhound',
		icon: {
			light: 'file:../../icons/webhound.svg',
			dark: 'file:../../icons/webhound.dark.svg',
		},
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Run controllable, inspectable Webhound research from an n8n workflow',
		defaults: {
			name: 'Webhound',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'webhoundApi',
				required: true,
			},
		],
		properties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('webhoundApi');
		const secret = String(credentials.webhoundKey ?? '').trim();

		if (!secret) {
			throw new NodeOperationError(this.getNode(), 'WEBHOUND_KEY is missing.');
		}

		const configuredOperation = String(
			this.getNodeParameter('operation', 0, 'startReport'),
		);
		if (isSpendStart(configuredOperation) && items.length !== 1) {
			throw new NodeOperationError(
				this.getNode(),
				'Spend-bearing starts require exactly one input item so the approved budget cannot be multiplied across a batch.',
			);
		}

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const rawOperation = String(
					this.getNodeParameter('operation', itemIndex, 'startReport'),
				);
				if (!WEBHOUND_OPERATIONS.includes(rawOperation as WebhoundOperation)) {
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported operation: ${rawOperation}`,
						{ itemIndex },
					);
				}
				const operation = rawOperation as WebhoundOperation;
				if (isSpendStart(operation) && items.length !== 1) {
					throw new NodeOperationError(
						this.getNode(),
						'Spend-bearing starts require exactly one input item so the approved budget cannot be multiplied across a batch.',
						{ itemIndex },
					);
				}
				const parameters = operationParameters(this, operation, itemIndex);
				const prepared = prepareWebhoundCall(operation, parameters);
				const result = await callWebhoundTool.call(
					this,
					prepared.toolName,
					prepared.arguments,
					itemIndex,
					secret,
				);

				const output: IDataObject = {
					...result.structuredContent,
					mcp_summary: result.summary,
				};
				returnData.push({
					json: output,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				const message = safeErrorMessage(error, secret);
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), message, { itemIndex });
			}
		}

		return [returnData];
	}
}
