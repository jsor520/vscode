/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IAIProvider, IAIService, IChatChunk, IChatMessage, IChatOptions } from '../../../../../platform/ai/common/aiService.js';
import { ToolRegistry } from '../../common/toolRegistry.js';
import { XuanjiChatService } from '../../browser/chat/xuanjiChatService.js';

class StubAIService implements IAIService {
	declare readonly _serviceBrand: undefined;

	readonly receivedRequests: { messages: IChatMessage[]; options: IChatOptions }[] = [];
	private _requestIndex = 0;

	constructor(private readonly _responses: IChatChunk[][]) { }

	async *chat(messages: IChatMessage[], options: IChatOptions, _token?: CancellationToken): AsyncIterable<IChatChunk> {
		this.receivedRequests.push({
			messages: messages.map(message => ({
				...message,
				attachments: message.attachments ? [...message.attachments] : undefined,
				toolCalls: message.toolCalls ? message.toolCalls.map(toolCall => ({ ...toolCall })) : undefined,
			})),
			options,
		});

		const response = this._responses[this._requestIndex++];
		if (!response) {
			throw new Error('Unexpected extra chat request');
		}

		for (const chunk of response) {
			yield chunk;
		}
	}

	async complete() {
		return [];
	}

	async embed() {
		return [];
	}

	getActiveProvider(): IAIProvider {
		return { id: 'stub', name: 'Stub', models: ['stub-model'] };
	}

	setActiveProvider(): void { }

	listProviders(): IAIProvider[] {
		return [this.getActiveProvider()];
	}
}

suite('XuanjiChatService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('executes tool calls and resumes the assistant response', async () => {
		const aiService = new StubAIService([
			[
				{ type: 'thinking', content: 'Inspecting the workspace' },
				{ type: 'tool_use', content: '', toolCallId: 'call_read_1', toolName: 'read_file', toolInput: { path: 'src/index.ts' } },
				{ type: 'done', content: '' },
			],
			[
				{ type: 'text', content: 'I found the relevant file.' },
				{ type: 'done', content: '' },
			],
		]);
		const toolRegistry = store.add(new ToolRegistry());
		store.add(toolRegistry.registerTool({
			name: 'read_file',
			description: 'Read a file',
			inputSchema: { type: 'object' },
			execute: async input => ({ content: `Loaded ${(input as { path: string }).path}` }),
		}));
		const service = store.add(new XuanjiChatService(
			aiService,
			toolRegistry,
			new TestConfigurationService(),
			{ collectRules: async () => 'Always explain edits before applying them.' },
		));

		await service.sendMessage('Inspect the project');

		assert.deepStrictEqual(
			service.model.messages.map(message => ({
				role: message.role,
				kind: message.kind,
				label: message.label,
				content: message.content,
				isStreaming: message.isStreaming,
			})),
			[
				{ role: 'user', kind: 'message', label: undefined, content: 'Inspect the project', isStreaming: false },
				{ role: 'assistant', kind: 'thinking', label: 'Reasoning', content: 'Inspecting the workspace', isStreaming: false },
				{ role: 'assistant', kind: 'tool_use', label: 'read_file', content: '```json\n{\n  "path": "src/index.ts"\n}\n```', isStreaming: false },
				{ role: 'assistant', kind: 'tool_result', label: 'read_file', content: 'Loaded src/index.ts', isStreaming: false },
				{ role: 'assistant', kind: 'message', label: undefined, content: 'I found the relevant file.', isStreaming: false },
			],
		);

		assert.strictEqual(aiService.receivedRequests.length, 2);
		assert.strictEqual(aiService.receivedRequests[0].messages[0].role, 'system');
		assert.strictEqual(aiService.receivedRequests[1].messages.at(-2)?.role, 'assistant');
		assert.deepStrictEqual(aiService.receivedRequests[1].messages.at(-2)?.toolCalls, [{
			id: 'call_read_1',
			name: 'read_file',
			input: { path: 'src/index.ts' },
		}]);
		assert.deepStrictEqual(aiService.receivedRequests[1].messages.at(-1), {
			role: 'tool',
			content: 'Loaded src/index.ts',
			attachments: undefined,
			toolCallId: 'call_read_1',
			toolName: 'read_file',
			toolCalls: undefined,
		});
		assert.deepStrictEqual(service.model.toChatMessages(), [
			{ role: 'user', content: 'Inspect the project', attachments: undefined },
			{ role: 'assistant', content: 'I found the relevant file.', attachments: undefined },
		]);
	});

	test('does not leave an empty assistant message behind when the request fails early', async () => {
		const aiService = new StubAIService([]);
		aiService.chat = (async function* () {
			throw new Error('Network unavailable');
		}) as IAIService['chat'];
		const service = store.add(new XuanjiChatService(aiService, store.add(new ToolRegistry()), new TestConfigurationService()));

		await service.sendMessage('Ping');

		assert.deepStrictEqual(
			service.model.messages.map(message => ({
				role: message.role,
				kind: message.kind,
				content: message.content,
			})),
			[
				{ role: 'user', kind: 'message', content: 'Ping' },
				{ role: 'assistant', kind: 'error', content: 'Network unavailable' },
			],
		);
		assert.strictEqual(service.model.toChatMessages().length, 1);
	});
});
