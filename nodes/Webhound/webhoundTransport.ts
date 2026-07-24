import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';

import {
	WEBHOUND_MCP_ENDPOINT,
	WEBHOUND_MCP_PROTOCOL_VERSION,
	WEBHOUND_PACKAGE_VERSION,
	WEBHOUND_REQUEST_TIMEOUT_MS,
} from './webhound.constants';

interface JsonRpcEnvelope extends IDataObject {
	id?: string | number | null;
	result?: IDataObject;
	error?: IDataObject;
}

interface WebhoundHttpResponse {
	body: unknown;
	headers?: IDataObject;
	statusCode?: number;
}

export interface WebhoundToolResult {
	summary: string;
	structuredContent: IDataObject;
}

export class WebhoundTransportError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function redactSecret(text: string, secret: string): string {
	const value = String(text || '');
	if (!secret) return value;
	return value.split(secret).join('[REDACTED]');
}

export function parseSseEnvelope(body: string): JsonRpcEnvelope {
	let eventData: string[] = [];
	const candidates: JsonRpcEnvelope[] = [];

	const flush = (): void => {
		if (eventData.length === 0) return;
		const raw = eventData.join('\n').trim();
		eventData = [];
		if (!raw || raw === '[DONE]') return;
		try {
			const parsed: unknown = JSON.parse(raw);
			if (isRecord(parsed)) candidates.push(parsed as JsonRpcEnvelope);
		} catch {
			// Ignore non-JSON progress events and continue to the final JSON-RPC event.
		}
	};

	for (const line of body.split(/\r?\n/)) {
		if (!line) {
			flush();
		} else if (line.startsWith('data:')) {
			eventData.push(line.slice(5).trimStart());
		}
	}
	flush();

	for (let index = candidates.length - 1; index >= 0; index--) {
		const candidate = candidates[index];
		if (candidate.result !== undefined || candidate.error !== undefined) return candidate;
	}

	throw new WebhoundTransportError(
		'Webhound MCP returned no complete Server-Sent Event.',
	);
}

export function parseMcpEnvelope(body: unknown, contentType = ''): JsonRpcEnvelope {
	if (isRecord(body)) return body as JsonRpcEnvelope;

	const text = typeof body === 'string' ? body : String(body ?? '');
	if (contentType.toLowerCase().includes('text/event-stream') || text.includes('\ndata:')) {
		return parseSseEnvelope(text);
	}

	try {
		const parsed: unknown = JSON.parse(text);
		if (!isRecord(parsed)) {
			throw new WebhoundTransportError(
				'Webhound MCP returned an invalid JSON-RPC envelope.',
			);
		}
		return parsed as JsonRpcEnvelope;
	} catch (error) {
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- The execute method converts this pure parser error to NodeOperationError.
		if (error instanceof WebhoundTransportError) throw error;
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- The execute method converts this pure parser error to NodeOperationError.
		throw new WebhoundTransportError('Webhound MCP returned invalid JSON.');
	}
}

function headerValue(headers: IDataObject | undefined, name: string): string {
	if (!headers) return '';
	const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
	return match ? String(match[1] ?? '') : '';
}

function responseStatus(response: WebhoundHttpResponse): number {
	const status = Number(response.statusCode ?? 200);
	return Number.isFinite(status) ? status : 200;
}

function assertHttpSuccess(response: WebhoundHttpResponse): void {
	const status = responseStatus(response);
	if ([301, 302, 303, 307, 308].includes(status)) {
		throw new WebhoundTransportError(
			'Webhound MCP returned an unexpected redirect; WEBHOUND_KEY was not forwarded.',
		);
	}
	if (status === 401 || status === 403) {
		throw new WebhoundTransportError(
			'Webhound rejected WEBHOUND_KEY. Create or replace this user credential at https://www.webhound.ai/api.',
		);
	}
	if (status === 429) {
		throw new WebhoundTransportError(
			'Webhound is rate-limiting requests. Wait before trying again.',
		);
	}
	if (status >= 500) {
		throw new WebhoundTransportError(
			`Webhound MCP is temporarily unavailable (HTTP ${status}).`,
		);
	}
	if (status >= 400) {
		throw new WebhoundTransportError(`Webhound MCP rejected the request (HTTP ${status}).`);
	}
	if (status !== 200 && status !== 201) {
		throw new WebhoundTransportError(
			`Webhound MCP returned unexpected HTTP ${status}.`,
		);
	}
}

function joinTextContent(content: unknown): string {
	if (!Array.isArray(content)) return '';
	return content
		.filter(
			(block): block is { type: string; text: string } =>
				isRecord(block) && block.type === 'text' && typeof block.text === 'string',
		)
		.map((block) => block.text)
		.filter(Boolean)
		.join('\n');
}

export function extractToolResult(
	envelope: JsonRpcEnvelope,
	requestId: string,
	secret: string,
	toolName: string,
): WebhoundToolResult {
	if (envelope.id !== undefined && envelope.id !== null && envelope.id !== requestId) {
		throw new WebhoundTransportError('Webhound MCP returned a mismatched response.');
	}

	if (isRecord(envelope.error)) {
		const code = String(envelope.error.code ?? 'unknown');
		const message = redactSecret(
			String(envelope.error.message ?? 'Unknown MCP error'),
			secret,
		);
		throw new WebhoundTransportError(`Webhound MCP error (${code}): ${message}`);
	}

	if (!isRecord(envelope.result)) {
		throw new WebhoundTransportError('Webhound MCP returned no tool result.');
	}

	const summary = joinTextContent(envelope.result.content);
	if (envelope.result.isError === true) {
		throw new WebhoundTransportError(
			redactSecret(summary || 'Webhound rejected the tool call.', secret),
		);
	}

	const structured = isRecord(envelope.result.structuredContent)
		? (envelope.result.structuredContent as IDataObject)
		: ({ content: (envelope.result.content ?? []) as JsonObject } as IDataObject);

	return {
		summary: summary || `${toolName} completed.`,
		structuredContent: structured,
	};
}

export async function callWebhoundTool(
	this: IExecuteFunctions,
	toolName: string,
	argumentsValue: IDataObject,
	itemIndex: number,
	secret: string,
): Promise<WebhoundToolResult> {
	const requestId = `n8n-${Date.now()}-${itemIndex}`;
	const options: IHttpRequestOptions = {
		method: 'POST',
		url: WEBHOUND_MCP_ENDPOINT,
		headers: {
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${secret}`,
			'Content-Type': 'application/json',
			'MCP-Protocol-Version': WEBHOUND_MCP_PROTOCOL_VERSION,
			'User-Agent': `n8n-nodes-webhound/${WEBHOUND_PACKAGE_VERSION}`,
		},
		body: {
			jsonrpc: '2.0',
			id: requestId,
			method: 'tools/call',
			params: {
				name: toolName,
				arguments: argumentsValue,
			},
		},
		disableFollowRedirect: true,
		ignoreHttpStatusErrors: true,
		returnFullResponse: true,
		timeout: WEBHOUND_REQUEST_TIMEOUT_MS,
		json: false,
	};

	let response: WebhoundHttpResponse;
	try {
		response = (await this.helpers.httpRequest.call(this, options)) as WebhoundHttpResponse;
	} catch {
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- The execute method adds item context without exposing the credential-bearing request error.
		throw new WebhoundTransportError(
			'Could not reach Webhound MCP. The request was not retried.',
		);
	}

	assertHttpSuccess(response);
	const contentType = headerValue(response.headers, 'content-type');
	const envelope = parseMcpEnvelope(response.body, contentType);
	return extractToolResult(envelope, requestId, secret, toolName);
}
