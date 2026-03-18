/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IAIService, IChatMessage, IChatOptions, IChatToolCall, IContextAttachment } from '../../../../../platform/ai/common/aiService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { XuanjiAiSettings } from '../../../../../platform/ai/common/aiSettings.js';
import { IToolInvocationResult, IToolRegistry } from '../../common/toolRegistry.js';
import { XuanjiToolExecutor } from '../../common/toolExecutor.js';
import { XuanjiChatModel } from './xuanjiChatModel.js';

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatToolLabel(toolName?: string): string {
	return toolName || 'Tool';
}

function formatToolPayload(input: unknown): string {
	if (typeof input === 'string') {
		return input;
	}
	if (input === undefined) {
		return '';
	}
	try {
		return `\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``;
	} catch {
		return String(input);
	}
}

export class XuanjiChatService extends Disposable {

	private readonly _model = this._register(new XuanjiChatModel());
	private readonly _toolExecutor: XuanjiToolExecutor;
	private _currentCancellationTokenSource: CancellationTokenSource | undefined;

	constructor(
		aiService: IAIService,
		toolRegistry: IToolRegistry,
		private readonly _configurationService: IConfigurationService,
		private readonly _rulesProvider?: { collectRules(): Promise<string> },
	) {
		super();
		this._toolExecutor = new XuanjiToolExecutor(aiService, toolRegistry);
	}

	get model(): XuanjiChatModel {
		return this._model;
	}

	async sendMessage(content: string, attachments?: IContextAttachment[]): Promise<void> {
		this.stopGeneration();
		this._model.addUserMessage(content, attachments);

		const cancellationTokenSource = new CancellationTokenSource();
		this._currentCancellationTokenSource = cancellationTokenSource;
		this._model.startGeneration();

		try {
			const messages = this._model.toChatMessages();
			const conversation = await this._buildConversation(messages);
			const options: IChatOptions = {
				model: this._configurationService.getValue<string>(XuanjiAiSettings.Model) || undefined,
				maxTokens: this._configurationService.getValue<number>(XuanjiAiSettings.MaxTokens) || undefined,
			};

			const toolCallLimit = this._configurationService.getValue<number>(XuanjiAiSettings.ToolMaxCalls) || 25;

			await this._toolExecutor.executeConversation(
				conversation,
				options,
				{
					onText: text => this._model.appendToLastAssistant(text),
					onThinking: text => this._model.appendThinking(text),
					onToolUse: toolCall => this._model.addToolUse(formatToolLabel(toolCall.name), formatToolPayload(toolCall.input)),
					onToolResult: (toolCall, result) => this._handleToolResult(toolCall, result),
					onError: message => this._model.addError(message),
				},
				cancellationTokenSource.token,
				toolCallLimit,
			);
		} catch (error) {
			this._model.addError(getErrorMessage(error));
		} finally {
			this._model.finishGeneration();
			if (this._currentCancellationTokenSource === cancellationTokenSource) {
				this._currentCancellationTokenSource = undefined;
			}
			cancellationTokenSource.dispose();
		}
	}

	stopGeneration(): void {
		if (!this._currentCancellationTokenSource) {
			return;
		}

		this._currentCancellationTokenSource.cancel();
		this._currentCancellationTokenSource = undefined;
		this._model.finishGeneration();
	}

	clearHistory(): void {
		this.stopGeneration();
		this._model.clear();
	}

	private async _buildConversation(messages: IChatMessage[]): Promise<IChatMessage[]> {
		const conversation = [...messages];
		if (!this._rulesProvider) {
			return conversation;
		}

		try {
			const rules = await this._rulesProvider.collectRules();
			if (rules) {
				conversation.unshift({ role: 'system', content: rules });
			}
		} catch {
			// Ignore rules loading failures for chat requests.
		}

		return conversation;
	}

	private _handleToolResult(toolCall: IChatToolCall, result: IToolInvocationResult): void {
		const label = formatToolLabel(toolCall.name);
		const content = result.content || '<empty result>';
		this._model.addToolResult(result.isError ? `${label} (failed)` : label, content);
	}
}



