/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IAIProvider, IAIService, IChatChunk, IChatMessage, IChatOptions } from '../../../../../platform/ai/common/aiService.js';
import { ToolRegistry } from '../../common/toolRegistry.js';
import { IXuanjiToolExecutionObserver, XuanjiToolExecutor } from '../../common/toolExecutor.js';

class StubAIService implements IAIService {
	declare readonly _serviceBrand: undefined;

	private _requestIndex = 0;

	constructor(private readonly _responses: IChatChunk[][]) { }

	async *chat(_messages: IChatMessage[], _options: IChatOptions): AsyncIterable<IChatChunk> {
		const response = this._responses[this._requestIndex++] || [];
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

function createObserver() {
	const state = {
		text: [] as string[],
		thinking: [] as string[],
		toolUses: [] as string[],
		toolProgress: [] as string[],
		toolResults: [] as string[],
		errors: [] as string[],
	};

	const observer: IXuanjiToolExecutionObserver = {
		onText: text => state.text.push(text),
		onThinking: text => state.thinking.push(text),
		onToolUse: toolCall => state.toolUses.push(toolCall.name),
		onToolProgress: (toolCall, result) => state.toolProgress.push(`${toolCall.name}:${result.content}`),
		onToolResult: (toolCall, result) => state.toolResults.push(`${toolCall.name}:${result.content}`),
		onError: message => state.errors.push(message),
	};

	return { observer, state };
}

suite('XuanjiToolExecutor', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('executes tool calls and continues the conversation', async () => {
		const toolRegistry = store.add(new ToolRegistry());
		store.add(toolRegistry.registerTool({
			name: 'read_file',
			description: 'Read a file',
			inputSchema: { type: 'object' },
			execute: async input => ({ content: `Loaded ${(input as { path: string }).path}` }),
		}));
		const executor = new XuanjiToolExecutor(new StubAIService([
			[
				{ type: 'tool_use', content: '', toolCallId: 'call_1', toolName: 'read_file', toolInput: { path: 'src/index.ts' } },
				{ type: 'done', content: '' },
			],
			[
				{ type: 'text', content: 'Done.' },
				{ type: 'done', content: '' },
			],
		]), toolRegistry);
		const { observer, state } = createObserver();

		const result = await executor.executeConversation([
			{ role: 'user', content: 'Inspect the file' },
		], {}, observer, CancellationToken.None);

		assert.strictEqual(result.limitHit, false);
		assert.strictEqual(result.toolCallCount, 1);
		assert.deepStrictEqual(state.toolUses, ['read_file']);
		assert.deepStrictEqual(state.toolResults, ['read_file:Loaded src/index.ts']);
		assert.deepStrictEqual(state.text, ['Done.']);
		assert.strictEqual(result.messages.length, 4);
		assert.deepStrictEqual(result.messages[1].toolCalls, [{ id: 'call_1', name: 'read_file', input: { path: 'src/index.ts' } }]);
		assert.deepStrictEqual(result.messages[2], {
			role: 'tool',
			content: 'Loaded src/index.ts',
			toolCallId: 'call_1',
			toolName: 'read_file',
		});
	});

	test('stops when tool call limit is exceeded', async () => {
		const executor = new XuanjiToolExecutor(new StubAIService([[
			{ type: 'tool_use', content: '', toolCallId: 'call_1', toolName: 'read_file', toolInput: { path: 'a' } },
			{ type: 'tool_use', content: '', toolCallId: 'call_2', toolName: 'read_file', toolInput: { path: 'b' } },
			{ type: 'done', content: '' },
		]]), store.add(new ToolRegistry()));
		const { observer, state } = createObserver();

		const result = await executor.executeConversation([{ role: 'user', content: 'Go' }], {}, observer, CancellationToken.None, 1);

		assert.strictEqual(result.limitHit, true);
		assert.strictEqual(result.toolCallCount, 2);
		assert.deepStrictEqual(state.toolUses, ['read_file']);
		assert.deepStrictEqual(state.errors, ['Tool call limit reached (1).']);
		assert.strictEqual(result.messages.length, 1);
	});

	test('reports tool progress updates before the final result', async () => {
		const toolRegistry = store.add(new ToolRegistry());
		store.add(toolRegistry.registerTool({
			name: 'run_command',
			description: 'Run a command',
			inputSchema: { type: 'object' },
			execute: async (_input, _token, context) => {
				context?.reportProgress({ content: 'Running\n\nStdout:\n\n```text\nhello\n```' });
				context?.reportProgress({ content: 'Running\n\nStdout:\n\n```text\nhello\nworld\n```' });
				return { content: 'Exit code: 0\n\nStdout:\n\n```text\nhello\nworld\n```' };
			},
		}));
		const executor = new XuanjiToolExecutor(new StubAIService([
			[
				{ type: 'tool_use', content: '', toolCallId: 'call_cmd_1', toolName: 'run_command', toolInput: { command: 'echo hello' } },
				{ type: 'done', content: '' },
			],
		]), toolRegistry);
		const { observer, state } = createObserver();

		await executor.executeConversation([{ role: 'user', content: 'Run it' }], {}, observer, CancellationToken.None);

		assert.deepStrictEqual(state.toolUses, ['run_command']);
		assert.deepStrictEqual(state.toolProgress, [
			'run_command:Running\n\nStdout:\n\n```text\nhello\n```',
			'run_command:Running\n\nStdout:\n\n```text\nhello\nworld\n```',
		]);
		assert.deepStrictEqual(state.toolResults, [
			'run_command:Exit code: 0\n\nStdout:\n\n```text\nhello\nworld\n```',
		]);
	});
});
