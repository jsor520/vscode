/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IAIProvider, IAIService, IChatChunk, IChatMessage, IChatOptions } from '../../../../../platform/ai/common/aiService.js';
import { XuanjiChatService } from '../../browser/chat/xuanjiChatService.js';

class StubAIService implements IAIService {
	declare readonly _serviceBrand: undefined;

	readonly receivedRequests: { messages: IChatMessage[]; options: IChatOptions }[] = [];

	constructor(private readonly _chunksFactory: () => AsyncIterable<IChatChunk>) { }

	chat(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IChatChunk> {
		this.receivedRequests.push({ messages: [...messages], options });
		return this._chunksFactory();
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

	test('surfaces thinking and tool events without polluting chat history', async () => {
		const service = store.add(new XuanjiChatService(
			new StubAIService(async function* () {
				yield { type: 'thinking', content: 'Inspecting the workspace' };
				yield { type: 'tool_use', content: '', toolName: 'read_file', toolInput: { path: 'src/index.ts' } };
				yield { type: 'tool_result', content: 'File loaded', toolName: 'read_file' };
				yield { type: 'text', content: 'I found the relevant file.' };
				yield { type: 'done', content: '' };
			}),
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
				{ role: 'assistant', kind: 'tool_result', label: 'read_file', content: 'File loaded', isStreaming: false },
				{ role: 'assistant', kind: 'message', label: undefined, content: 'I found the relevant file.', isStreaming: false },
			],
		);

		assert.deepStrictEqual(service.model.toChatMessages(), [
			{ role: 'user', content: 'Inspect the project', attachments: undefined },
			{ role: 'assistant', content: 'I found the relevant file.', attachments: undefined },
		]);
	});

	test('does not leave an empty assistant message behind when the request fails early', async () => {
		const aiService = new StubAIService(async function* () {
			throw new Error('Network unavailable');
		});
		const service = store.add(new XuanjiChatService(aiService, new TestConfigurationService()));

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
