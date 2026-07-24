import type {
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import {
	WEBHOUND_MCP_ENDPOINT,
	WEBHOUND_MCP_PROTOCOL_VERSION,
} from '../nodes/Webhound/webhound.constants';

export class WebhoundApi implements ICredentialType {
	name = 'webhoundApi';

	displayName = 'Webhound API';

	icon: Icon = {
		light: 'file:../icons/webhound.svg',
		dark: 'file:../icons/webhound.dark.svg',
	};

	documentationUrl = 'https://www.webhound.ai/api';

	properties: INodeProperties[] = [
		{
			displayName: 'WEBHOUND_KEY',
			name: 'webhoundKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your own Webhound API key. n8n encrypts this credential and the node never accepts a publisher or shared key.',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			method: 'POST',
			url: WEBHOUND_MCP_ENDPOINT,
			headers: {
				Accept: 'application/json, text/event-stream',
				Authorization: '=Bearer {{$credentials?.webhoundKey}}',
				'Content-Type': 'application/json',
				'MCP-Protocol-Version': WEBHOUND_MCP_PROTOCOL_VERSION,
			},
			body: {
				jsonrpc: '2.0',
				id: 'n8n-credential-test',
				method: 'tools/call',
				params: {
					name: 'webhound_account',
					arguments: {},
				},
			},
			disableFollowRedirect: true,
			sendCredentialsOnCrossOriginRedirect: false,
		},
	};
}
