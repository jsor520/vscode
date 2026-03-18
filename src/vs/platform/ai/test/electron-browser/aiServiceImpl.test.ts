/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../log/common/log.js';
import { IAICredentialsService } from '../../common/aiCredentialsService.js';
import { IChatChunk, ICompletionContext, ITool } from '../../common/aiService.js';
import { ICustomModelConfig, XuanjiAiSettings } from '../../common/aiSettings.js';
import { ElectronAIServiceImpl } from '../../electron-browser/aiServiceImpl.js';

class MutableTestConfigurationService extends TestConfigurationService {
	override updateValue(key: string, value: unknown): Promise<void> {
		return this.setUserConfiguration(key, value);
	}
}

class StubAICredentialsService implements IAICredentialsService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly secrets: Record<string, string | undefined>) { }

	async migrateLegacyModelsIfNeeded(): Promise<void> { }
	async listCredentials() { return []; }
	async getCredential() { return undefined; }
	async getCredentialSecret(id: string): Promise<string | undefined> { return this.secrets[id]; }
	async hasCredentialSecret(id: string): Promise<boolean> { return !!this.secrets[id]; }
	async saveCredential(): Promise<void> { }
	async deleteCredential(): Promise<void> { }
}

function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const line of lines) {
				controller.enqueue(encoder.encode(`${line}\n`));
			}
			controller.close();
		}
	});
}

async function collectChunks(iterable: AsyncIterable<IChatChunk>): Promise<IChatChunk[]> {
	const chunks: IChatChunk[] = [];
	for await (const chunk of iterable) {
		chunks.push(chunk);
	}
	return chunks;
}

suite('ElectronAIServiceImpl', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const completionContext: ICompletionContext = {
		fileUri: 'file:///test.ts',
		position: { line: 1, column: 1 },
		prefix: 'const x = ',
		suffix: '',
		language: 'typescript',
	};

	function createService(model: ICustomModelConfig, secrets: Record<string, string | undefined>) {
		const configService = new MutableTestConfigurationService({
			[XuanjiAiSettings.Model]: model.id,
			[XuanjiAiSettings.CustomModels]: <ICustomModelConfig[]>[model],
		});
		const credentialsService = new StubAICredentialsService(secrets);
		return store.add(new ElectronAIServiceImpl(configService, credentialsService, new NullLogService()));
	}

	test('uses Authorization header from credential for openai-compatible models', async () => {
		const service = createService({
			id: 'gpt-4o',
			name: 'GPT-4o',
			provider: 'OpenAI',
			apiFormat: 'openai',
			apiBaseUrl: 'https://api.openai.com',
			credentialId: 'openai-main',
		}, { 'openai-main': 'sk-openai-test-1234' });

		const originalFetch = globalThis.fetch;
		let capturedAuthorization: string | undefined;
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			capturedAuthorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
			return {
				ok: true,
				text: async () => JSON.stringify({
					choices: [{ message: { content: 'console.log("hi")' } }],
				}),
			} as Response;
		}) as typeof fetch;

		try {
			const result = await service.complete(completionContext);
			assert.strictEqual(capturedAuthorization, 'Bearer sk-openai-test-1234');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].text, 'console.log("hi")');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('uses x-api-key header from credential for anthropic models', async () => {
		const service = createService({
			id: 'claude-sonnet-4-6',
			name: 'Claude Sonnet 4.6',
			provider: 'Anthropic',
			apiFormat: 'anthropic',
			apiBaseUrl: 'https://api.anthropic.com',
			credentialId: 'anthropic-main',
		}, { 'anthropic-main': 'sk-ant-test-5678' });

		const originalFetch = globalThis.fetch;
		let capturedApiKey: string | undefined;
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			capturedApiKey = (init?.headers as Record<string, string> | undefined)?.['x-api-key'];
			return {
				ok: true,
				text: async () => JSON.stringify({
					content: [{ type: 'text', text: 'function migrated() {}' }],
				}),
			} as Response;
		}) as typeof fetch;

		try {
			const result = await service.complete(completionContext);
			assert.strictEqual(capturedApiKey, 'sk-ant-test-5678');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].text, 'function migrated() {}');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('passes tools to openai-compatible chat requests and parses streamed tool calls', async () => {
		const service = createService({
			id: 'gpt-4o',
			name: 'GPT-4o',
			provider: 'OpenAI',
			apiFormat: 'openai',
			apiBaseUrl: 'https://api.openai.com',
			credentialId: 'openai-main',
		}, { 'openai-main': 'sk-openai-test-1234' });
		const tools: ITool[] = [{
			name: 'read_file',
			description: 'Read a file',
			inputSchema: { type: 'object' },
		}];

		const originalFetch = globalThis.fetch;
		let capturedBody: Record<string, unknown> | undefined;
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			capturedBody = JSON.parse(String(init?.body));
			return {
				ok: true,
				body: createSSEStream([
					'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"src/"}}]},"finish_reason":null}]}',
					'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"index.ts\\"}"}}]},"finish_reason":"tool_calls"}]}',
				]),
				text: async () => '',
			} as Response;
		}) as typeof fetch;

		try {
			const chunks = await collectChunks(service.chat([{ role: 'user', content: 'Inspect the file' }], { tools }, CancellationToken.None));
			assert.ok(Array.isArray(capturedBody?.tools));
			assert.strictEqual(capturedBody?.tool_choice, 'auto');
			assert.deepStrictEqual(chunks, [
				{ type: 'tool_use', content: '', toolCallId: 'call_1', toolName: 'read_file', toolInput: { path: 'src/index.ts' } },
				{ type: 'done', content: '' },
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('passes tools to anthropic chat requests and parses streamed tool calls', async () => {
		const service = createService({
			id: 'claude-sonnet-4-6',
			name: 'Claude Sonnet 4.6',
			provider: 'Anthropic',
			apiFormat: 'anthropic',
			apiBaseUrl: 'https://api.anthropic.com',
			credentialId: 'anthropic-main',
		}, { 'anthropic-main': 'sk-ant-test-5678' });
		const tools: ITool[] = [{
			name: 'list_directory',
			description: 'List a directory',
			inputSchema: { type: 'object' },
		}];

		const originalFetch = globalThis.fetch;
		let capturedBody: Record<string, unknown> | undefined;
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			capturedBody = JSON.parse(String(init?.body));
			return {
				ok: true,
				body: createSSEStream([
					'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"list_directory","input":{}}}',
					'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"src\\",\\"recursive\\":true}"}}',
					'data: {"type":"content_block_stop","index":0}',
					'data: {"type":"message_stop"}',
				]),
				text: async () => '',
			} as Response;
		}) as typeof fetch;

		try {
			const chunks = await collectChunks(service.chat([{ role: 'user', content: 'List the workspace' }], { tools }, CancellationToken.None));
			assert.ok(Array.isArray(capturedBody?.tools));
			assert.deepStrictEqual(chunks, [
				{ type: 'tool_use', content: '', toolCallId: 'toolu_1', toolName: 'list_directory', toolInput: { path: 'src', recursive: true } },
				{ type: 'done', content: '' },
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});