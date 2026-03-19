/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IAIService, IChatMessage, IChatOptions, IChatToolCall } from '../../../../platform/ai/common/aiService.js';
import { IToolInvocationResult, IToolProgressUpdate, IToolRegistry } from './toolRegistry.js';

const DEFAULT_TOOL_CALL_LIMIT = 25;

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface IXuanjiToolExecutionObserver {
	onText(text: string): void;
	onThinking(text: string): void;
	onToolUse(toolCall: IChatToolCall): void;
	onToolProgress(toolCall: IChatToolCall, result: IToolProgressUpdate): void;
	onToolResult(toolCall: IChatToolCall, result: IToolInvocationResult): void;
	onError(message: string): void;
}

export interface IToolExecutorRunResult {
	readonly messages: readonly IChatMessage[];
	readonly toolCallCount: number;
	readonly limitHit: boolean;
}

export class XuanjiToolExecutor {
	constructor(
		private readonly _aiService: IAIService,
		private readonly _toolRegistry: IToolRegistry,
	) { }

	async executeConversation(
		messages: IChatMessage[],
		options: IChatOptions,
		observer: IXuanjiToolExecutionObserver,
		token: CancellationToken,
		toolCallLimit: number = DEFAULT_TOOL_CALL_LIMIT,
	): Promise<IToolExecutorRunResult> {
		const conversation = [...messages];
		const tools = options.tools?.length ? [...options.tools] : [...this._toolRegistry.listModelTools(options.model)];
		const requestOptions: IChatOptions = {
			...options,
			tools: tools.length ? tools : undefined,
		};
		let toolCallCount = 0;

		while (!token.isCancellationRequested) {
			let assistantText = '';
			const assistantToolCalls: IChatToolCall[] = [];
			let sawError = false;

			for await (const chunk of this._aiService.chat(conversation, requestOptions, token)) {
				if (token.isCancellationRequested) {
					break;
				}

				if (chunk.type === 'text') {
					assistantText += chunk.content;
					observer.onText(chunk.content);
				} else if (chunk.type === 'thinking') {
					observer.onThinking(chunk.content);
				} else if (chunk.type === 'tool_use') {
					toolCallCount++;
					if (toolCallCount > toolCallLimit) {
						observer.onError(`Tool call limit reached (${toolCallLimit}).`);
						return { messages: conversation, toolCallCount, limitHit: true };
					}

					const toolCall: IChatToolCall = {
						id: chunk.toolCallId,
						name: chunk.toolName || 'Tool',
						input: chunk.toolInput,
					};
					assistantToolCalls.push(toolCall);
					observer.onToolUse(toolCall);
				} else if (chunk.type === 'error') {
					observer.onError(chunk.content);
					sawError = true;
				} else if (chunk.type === 'tool_result') {
					observer.onToolResult({
						id: chunk.toolCallId,
						name: chunk.toolName || 'Tool',
						input: chunk.toolInput,
					}, { content: chunk.content });
				}
			}

			if (assistantText || assistantToolCalls.length) {
				conversation.push({
					role: 'assistant',
					content: assistantText,
					toolCalls: assistantToolCalls.length ? assistantToolCalls : undefined,
				});
			}

			if (sawError || !assistantToolCalls.length) {
				return { messages: conversation, toolCallCount, limitHit: false };
			}

			for (const toolCall of assistantToolCalls) {
				const result = await this._invokeTool(toolCall, token, progress => observer.onToolProgress(toolCall, progress));
				observer.onToolResult(toolCall, result);
				conversation.push({
					role: 'tool',
					content: result.content,
					toolCallId: toolCall.id,
					toolName: toolCall.name,
				});
			}
		}

		return { messages: conversation, toolCallCount, limitHit: false };
	}

	private async _invokeTool(toolCall: IChatToolCall, token: CancellationToken, onProgress: (progress: IToolProgressUpdate) => void): Promise<IToolInvocationResult> {
		const tool = this._toolRegistry.getTool(toolCall.name);
		if (!tool) {
			return { content: `Tool "${toolCall.name}" is not registered.`, isError: true };
		}
		if (tool.requiresConfirmation) {
			return { content: `Tool "${toolCall.name}" requires confirmation and cannot run automatically yet.`, isError: true };
		}

		try {
			const result = await this._toolRegistry.invokeTool(toolCall.name, toolCall.input, token, {
				reportProgress: progress => {
					try {
						onProgress(progress);
					} catch {
						// Ignore observer failures so tool execution can complete.
					}
				},
			});
			return {
				content: result.content || '<empty result>',
				isError: result.isError,
			};
		} catch (error) {
			return { content: getErrorMessage(error), isError: true };
		}
	}
}


