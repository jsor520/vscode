/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { XuanjiAiSettings } from '../../../../../platform/ai/common/aiSettings.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IAIProvider, IAIService, IChatChunk, IChatMessage, IChatOptions } from '../../../../../platform/ai/common/aiService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { XuanjiAgentController } from '../../browser/agent/agentController.js';
import { ToolRegistry } from '../../common/toolRegistry.js';
import { XuanjiChatService } from '../../browser/chat/xuanjiChatService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';

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

	function createAgentController(): XuanjiAgentController {
		const fileService = {
			createFolder: async () => undefined,
			writeFile: async () => undefined,
			readFile: async () => ({ value: VSBuffer.fromString('') }),
			exists: async () => true,
			resolve: async () => ({ children: [] }),
		};

		const workspaceFolder = { uri: URI.file('/workspace'), name: 'workspace' };
		const workspaceService = {
			getWorkspace: () => ({ folders: [workspaceFolder] }),
			getWorkspaceFolder: () => workspaceFolder,
		};

		const editorService = {
			openEditor: async () => undefined,
		};

		const languageService = {
			guessLanguageIdByFilepathOrFirstLine: () => 'typescript',
		};

		const logService = {
			error: () => undefined,
		};

		return store.add(new XuanjiAgentController(
			fileService as unknown as IFileService,
			workspaceService as unknown as IWorkspaceContextService,
			editorService as unknown as IEditorService,
			languageService as unknown as ILanguageService,
			logService as unknown as ILogService,
		));
	}

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

	test('streams tool progress into a single tool result message', async () => {
		const aiService = new StubAIService([
			[
				{ type: 'tool_use', content: '', toolCallId: 'call_cmd_1', toolName: 'run_command', toolInput: { command: 'echo hello' } },
				{ type: 'done', content: '' },
			],
			[
				{ type: 'text', content: 'Command finished.' },
				{ type: 'done', content: '' },
			],
		]);
		const toolRegistry = store.add(new ToolRegistry());
		let releaseCommand: (() => void) | undefined;
		store.add(toolRegistry.registerTool({
			name: 'run_command',
			description: 'Run a command',
			inputSchema: { type: 'object' },
			execute: async (_input, _token, context) => {
				context?.reportProgress({ content: 'Status: Running\n\nStdout:\n\n```text\nhello\n```' });
				await new Promise<void>(resolve => {
					releaseCommand = resolve;
				});
				context?.reportProgress({ content: 'Status: Running\n\nStdout:\n\n```text\nhello\nworld\n```' });
				return { content: 'Exit code: 0\n\nStdout:\n\n```text\nhello\nworld\n```' };
			},
		}));
		const service = store.add(new XuanjiChatService(aiService, toolRegistry, new TestConfigurationService()));

		const sendPromise = service.sendMessage('Run the command');
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(
			service.model.messages.map(message => ({
				role: message.role,
				kind: message.kind,
				label: message.label,
				content: message.content,
				isStreaming: message.isStreaming,
			})),
			[
				{ role: 'user', kind: 'message', label: undefined, content: 'Run the command', isStreaming: false },
				{ role: 'assistant', kind: 'tool_use', label: 'run_command', content: '```json\n{\n  "command": "echo hello"\n}\n```', isStreaming: false },
				{ role: 'assistant', kind: 'tool_result', label: 'run_command', content: 'Status: Running\n\nStdout:\n\n```text\nhello\n```', isStreaming: true },
			],
		);

		releaseCommand?.();
		await sendPromise;

		assert.deepStrictEqual(
			service.model.messages.map(message => ({
				role: message.role,
				kind: message.kind,
				label: message.label,
				content: message.content,
				isStreaming: message.isStreaming,
			})),
			[
				{ role: 'user', kind: 'message', label: undefined, content: 'Run the command', isStreaming: false },
				{ role: 'assistant', kind: 'tool_use', label: 'run_command', content: '```json\n{\n  "command": "echo hello"\n}\n```', isStreaming: false },
				{ role: 'assistant', kind: 'tool_result', label: 'run_command', content: 'Exit code: 0\n\nStdout:\n\n```text\nhello\nworld\n```', isStreaming: false },
				{ role: 'assistant', kind: 'message', label: undefined, content: 'Command finished.', isStreaming: false },
			],
		);
	});

	test('creates a visible plan in plan mode before execution', async () => {
		const aiService = new StubAIService([[
			{ type: 'thinking', content: 'Breaking the work down' },
			{ type: 'text', content: '1. Inspect the existing flow.\n2. Update the implementation.\n3. Verify the result.' },
			{ type: 'done', content: '' },
		]]);
		const service = store.add(new XuanjiChatService(
			aiService,
			store.add(new ToolRegistry()),
			new TestConfigurationService({ [XuanjiAiSettings.ChatMode]: 'plan' }),
		));

		await service.sendMessage('Refactor the command flow');

		assert.strictEqual(aiService.receivedRequests.length, 1);
		assert.strictEqual(aiService.receivedRequests[0].options.tools, undefined);
		assert.strictEqual(service.model.pendingPlan?.task, 'Refactor the command flow');
		assert.strictEqual(service.model.pendingPlan?.plan, '1. Inspect the existing flow.\n2. Update the implementation.\n3. Verify the result.');
		assert.deepStrictEqual(
			service.model.messages.map(message => ({
				role: message.role,
				kind: message.kind,
				label: message.label,
				content: message.content,
			})),
			[
				{ role: 'user', kind: 'message', label: undefined, content: 'Refactor the command flow' },
				{ role: 'assistant', kind: 'thinking', label: 'Reasoning', content: 'Breaking the work down' },
				{ role: 'assistant', kind: 'plan', label: 'Plan', content: '1. Inspect the existing flow.\n2. Update the implementation.\n3. Verify the result.' },
			],
		);
	});

	test('adds hidden planning guidance in agent mode', async () => {
		const aiService = new StubAIService([[
			{ type: 'text', content: 'Working on it.' },
			{ type: 'done', content: '' },
		]]);
		const service = store.add(new XuanjiChatService(
			aiService,
			store.add(new ToolRegistry()),
			new TestConfigurationService({ [XuanjiAiSettings.ChatMode]: 'agent' }),
		));

		await service.sendMessage('Investigate the bug');

		assert.strictEqual(aiService.receivedRequests.length, 1);
		assert.ok(aiService.receivedRequests[0].messages.some(message => message.role === 'system' && message.content.includes('Agent mode')));
		assert.deepStrictEqual(
			service.model.messages.map(message => ({
				role: message.role,
				kind: message.kind,
				content: message.content,
			})),
			[
				{ role: 'user', kind: 'message', content: 'Investigate the bug' },
				{ role: 'assistant', kind: 'message', content: 'Working on it.' },
			],
		);
	});

	test('executes the approved plan after user confirmation', async () => {
		const aiService = new StubAIService([
			[
				{ type: 'text', content: '1. Read the code.\n2. Make the edit.\n3. Run validation.' },
				{ type: 'done', content: '' },
			],
			[
				{ type: 'thinking', content: 'Following the approved plan' },
				{ type: 'text', content: 'Execution complete.' },
				{ type: 'done', content: '' },
			],
		]);
		const service = store.add(new XuanjiChatService(
			aiService,
			store.add(new ToolRegistry()),
			new TestConfigurationService({ [XuanjiAiSettings.ChatMode]: 'plan' }),
		));

		await service.sendMessage('Ship the planner');
		await service.executePendingPlan();

		assert.strictEqual(aiService.receivedRequests.length, 2);
		assert.strictEqual(service.model.pendingPlan, undefined);
		assert.strictEqual(aiService.receivedRequests[1].messages[0].role, 'system');
		assert.ok(aiService.receivedRequests[1].messages.some(message => message.role === 'system' && message.content.includes('approved the following execution plan')));
		assert.ok(aiService.receivedRequests[1].messages.some(message => message.role === 'user' && message.content.includes('Ship the planner')));
		assert.deepStrictEqual(
			service.model.messages.map(message => ({
				role: message.role,
				kind: message.kind,
				label: message.label,
				content: message.content,
			})),
			[
				{ role: 'user', kind: 'message', label: undefined, content: 'Ship the planner' },
				{ role: 'assistant', kind: 'plan', label: 'Plan', content: '1. Read the code.\n2. Make the edit.\n3. Run validation.' },
				{ role: 'assistant', kind: 'thinking', label: 'Reasoning', content: 'Following the approved plan' },
				{ role: 'assistant', kind: 'message', label: undefined, content: 'Execution complete.' },
			],
		);
	});

	test('pauses agent execution and resumes from the same task', async () => {
		const aiService = new StubAIService([
			[
				{ type: 'tool_use', content: '', toolCallId: 'call_read_pause', toolName: 'read_file', toolInput: { path: 'src/index.ts' } },
				{ type: 'done', content: '' },
			],
			[
				{ type: 'text', content: 'Finished after resume.' },
				{ type: 'done', content: '' },
			],
		]);
		const toolRegistry = store.add(new ToolRegistry());
		let releaseTool: (() => void) | undefined;
		store.add(toolRegistry.registerTool({
			name: 'read_file',
			description: 'Read a file',
			inputSchema: { type: 'object' },
			execute: async () => {
				await new Promise<void>(resolve => {
					releaseTool = resolve;
				});
				return { content: 'Loaded src/index.ts' };
			},
		}));
		const agentController = createAgentController();
		const service = store.add(new XuanjiChatService(
			aiService,
			toolRegistry,
			new TestConfigurationService({ [XuanjiAiSettings.ChatMode]: 'agent' }),
			undefined,
			agentController,
		));

		const sendPromise = service.sendMessage('Inspect and continue');
		await new Promise(resolve => setTimeout(resolve, 0));

		service.pauseAgentTask();
		releaseTool?.();
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.strictEqual(service.agentState?.isPaused, true);
		assert.strictEqual(service.model.messages.some(message => message.kind === 'tool_result' && message.content === 'Loaded src/index.ts'), true);
		assert.strictEqual(service.model.messages.some(message => message.kind === 'message' && message.content === 'Finished after resume.'), false);

		service.resumeAgentTask();
		await sendPromise;

		assert.strictEqual(service.agentState?.isPaused, false);
		assert.strictEqual(service.agentState?.status, 'completed');
		assert.strictEqual(service.model.messages.some(message => message.kind === 'message' && message.content === 'Finished after resume.'), true);
	});
});
