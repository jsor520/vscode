/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IAIService, IChatMessage, IChatOptions, IChatToolCall, IContextAttachment } from '../../../../../platform/ai/common/aiService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { XuanjiAiSettings, XuanjiChatMode } from '../../../../../platform/ai/common/aiSettings.js';
import { IXuanjiPlanDraft, XuanjiAgentPlanner } from '../../common/agentPlanner.js';
import { IToolInvocationResult, IToolProgressUpdate, IToolRegistry } from '../../common/toolRegistry.js';
import { XuanjiToolExecutor } from '../../common/toolExecutor.js';
import { IXuanjiAgentTaskState, XuanjiAgentController } from '../agent/agentController.js';
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
	private readonly _agentPlanner = new XuanjiAgentPlanner();
	private _currentCancellationTokenSource: CancellationTokenSource | undefined;
	private _pendingPlanDraft: IXuanjiPlanDraft | undefined;

	constructor(
		private readonly _aiService: IAIService,
		toolRegistry: IToolRegistry,
		private readonly _configurationService: IConfigurationService,
		private readonly _rulesProvider?: { collectRules(): Promise<string> },
		private readonly _agentController?: XuanjiAgentController,
	) {
		super();
		this._toolExecutor = new XuanjiToolExecutor(this._aiService, toolRegistry);
	}

	get model(): XuanjiChatModel {
		return this._model;
	}

	get agentState(): IXuanjiAgentTaskState | undefined {
		return this._agentController?.state;
	}

	get onDidChangeAgentState(): Event<IXuanjiAgentTaskState | undefined> {
		return this._agentController?.onDidChangeState ?? Event.None;
	}

	async sendMessage(content: string, attachments?: IContextAttachment[]): Promise<void> {
		this.stopGeneration();
		this._model.addUserMessage(content, attachments);

		const cancellationTokenSource = new CancellationTokenSource();
		this._currentCancellationTokenSource = cancellationTokenSource;
		this._model.startGeneration();

		try {
			const mode = this._getChatMode();
			if (mode === 'plan') {
				const nextDraft = this._pendingPlanDraft
					? {
						...this._pendingPlanDraft,
						attachments: [...this._pendingPlanDraft.attachments, ...(attachments || [])],
						feedback: [...this._pendingPlanDraft.feedback, content],
					}
					: {
						task: content,
						attachments: [...(attachments || [])],
						feedback: [] as string[],
						plan: '',
					};

				await this._generatePlan(nextDraft, cancellationTokenSource);
			} else {
				this._pendingPlanDraft = undefined;
				this._model.setPendingPlan(undefined);
				if (mode !== 'chat') {
					this._agentController?.beginTask(mode, content);
				}
				await this._runChatConversation(mode, cancellationTokenSource);
				if (mode !== 'chat') {
					this._agentController?.completeTask();
				}
			}
		} catch (error) {
			this._agentController?.recordError(getErrorMessage(error));
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
		this._agentController?.stopTask();
		this._model.finishGeneration();
	}

	clearHistory(): void {
		this.stopGeneration();
		this._pendingPlanDraft = undefined;
		this._model.clear();
	}

	async executePendingPlan(): Promise<void> {
		if (!this._pendingPlanDraft) {
			return;
		}

		this.stopGeneration();
		const cancellationTokenSource = new CancellationTokenSource();
		this._currentCancellationTokenSource = cancellationTokenSource;
		this._model.startGeneration();

		try {
			const approvedDraft = this._pendingPlanDraft;
			this._pendingPlanDraft = undefined;
			this._model.setPendingPlan(undefined);
			this._agentController?.beginTask('plan', approvedDraft.task);
			await this._runApprovedPlan(approvedDraft, cancellationTokenSource);
			this._agentController?.completeTask();
		} catch (error) {
			this._agentController?.recordError(getErrorMessage(error));
			this._model.addError(getErrorMessage(error));
		} finally {
			this._model.finishGeneration();
			if (this._currentCancellationTokenSource === cancellationTokenSource) {
				this._currentCancellationTokenSource = undefined;
			}
			cancellationTokenSource.dispose();
		}
	}

	async regeneratePlan(): Promise<void> {
		if (!this._pendingPlanDraft) {
			return;
		}

		this.stopGeneration();
		const cancellationTokenSource = new CancellationTokenSource();
		this._currentCancellationTokenSource = cancellationTokenSource;
		this._model.startGeneration();

		try {
			await this._generatePlan(this._pendingPlanDraft, cancellationTokenSource, true);
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

	async acceptAgentReview(reviewId: string): Promise<void> {
		await this._agentController?.acceptPendingReview(reviewId);
	}

	rejectAgentReview(reviewId: string): void {
		this._agentController?.rejectPendingReview(reviewId);
	}

	async openAgentReview(reviewId: string): Promise<void> {
		await this._agentController?.openPendingReview(reviewId);
	}

	private async _buildSystemMessages(): Promise<IChatMessage[]> {
		const systemMessages: IChatMessage[] = [];
		if (!this._rulesProvider) {
			return systemMessages;
		}

		try {
			const rules = await this._rulesProvider.collectRules();
			if (rules) {
				systemMessages.push({ role: 'system', content: rules });
			}
		} catch {
			// Ignore rules loading failures for chat requests.
		}

		return systemMessages;
	}

	private async _runChatConversation(mode: XuanjiChatMode, cancellationTokenSource: CancellationTokenSource): Promise<void> {
		const conversation = this._agentPlanner.applyExecutionMode(
			await this._buildSystemMessages(),
			this._model.toChatMessages(),
			mode,
		);
		const options = this._createChatOptions();
		const toolCallLimit = this._configurationService.getValue<number>(XuanjiAiSettings.ToolMaxCalls) || 25;

		await this._toolExecutor.executeConversation(
			conversation,
			options,
			{
				onText: text => this._model.appendToLastAssistant(text),
				onThinking: text => this._model.appendThinking(text),
				onToolUse: toolCall => {
					this._model.addToolUse(formatToolLabel(toolCall.name), formatToolPayload(toolCall.input), toolCall.id);
					this._agentController?.recordToolUse(toolCall);
				},
				onToolProgress: (toolCall, result) => this._handleToolProgress(toolCall, result),
				onToolResult: (toolCall, result) => {
					this._handleToolResult(toolCall, result);
					this._agentController?.recordToolResult(toolCall, result);
				},
				onError: message => {
					this._agentController?.recordError(message);
					this._model.addError(message);
				},
			},
			cancellationTokenSource.token,
			{
				toolCallLimit,
				createExecutionContext: mode === 'chat' || !this._agentController
					? undefined
					: () => ({
						mode,
						reviewHandler: this._agentController,
					}),
			},
		);
	}

	private async _runApprovedPlan(draft: IXuanjiPlanDraft, cancellationTokenSource: CancellationTokenSource): Promise<void> {
		const conversation = this._agentPlanner.createExecutionConversation(await this._buildSystemMessages(), draft);
		const options = this._createChatOptions();
		const toolCallLimit = this._configurationService.getValue<number>(XuanjiAiSettings.ToolMaxCalls) || 25;

		await this._toolExecutor.executeConversation(
			conversation,
			options,
			{
				onText: text => this._model.appendToLastAssistant(text),
				onThinking: text => this._model.appendThinking(text),
				onToolUse: toolCall => {
					this._model.addToolUse(formatToolLabel(toolCall.name), formatToolPayload(toolCall.input), toolCall.id);
					this._agentController?.recordToolUse(toolCall);
				},
				onToolProgress: (toolCall, result) => this._handleToolProgress(toolCall, result),
				onToolResult: (toolCall, result) => {
					this._handleToolResult(toolCall, result);
					this._agentController?.recordToolResult(toolCall, result);
				},
				onError: message => {
					this._agentController?.recordError(message);
					this._model.addError(message);
				},
			},
			cancellationTokenSource.token,
			{
				toolCallLimit,
				createExecutionContext: this._agentController ? () => ({
					mode: 'agent',
					reviewHandler: this._agentController,
				}) : undefined,
			},
		);
	}

	private async _generatePlan(draft: Omit<IXuanjiPlanDraft, 'plan'> | IXuanjiPlanDraft, cancellationTokenSource: CancellationTokenSource, revise = false): Promise<void> {
		this._pendingPlanDraft = undefined;
		this._model.setPendingPlan(undefined);

		const planConversation = this._agentPlanner.createPlanningConversation(await this._buildSystemMessages(), draft);
		const options = this._createChatOptions();
		let planText = '';

		for await (const chunk of this._aiService.chat(planConversation, { ...options, tools: undefined }, cancellationTokenSource.token)) {
			if (cancellationTokenSource.token.isCancellationRequested) {
				break;
			}

			if (chunk.type === 'text') {
				planText += chunk.content;
				this._model.appendPlan(chunk.content);
			} else if (chunk.type === 'thinking') {
				this._model.appendThinking(chunk.content);
			} else if (chunk.type === 'error') {
				this._model.addError(chunk.content);
				return;
			}
		}

		const finalizedDraft: IXuanjiPlanDraft = {
			...draft,
			plan: planText.trim(),
		};
		this._pendingPlanDraft = finalizedDraft;
		this._model.setPendingPlan(finalizedDraft);

		if (!planText.trim()) {
			this._model.addError(revise ? 'Failed to revise the plan.' : 'Failed to generate a plan.');
		}
	}

	private _createChatOptions(): IChatOptions {
		return {
			model: this._configurationService.getValue<string>(XuanjiAiSettings.Model) || undefined,
			maxTokens: this._configurationService.getValue<number>(XuanjiAiSettings.MaxTokens) || undefined,
		};
	}

	private _getChatMode(): XuanjiChatMode {
		const mode = this._configurationService.getValue<string>(XuanjiAiSettings.ChatMode);
		if (mode === 'agent' || mode === 'plan') {
			return mode;
		}
		return 'chat';
	}

	private _handleToolResult(toolCall: IChatToolCall, result: IToolInvocationResult): void {
		const label = formatToolLabel(toolCall.name);
		const content = result.content || '<empty result>';
		this._model.addToolResult(label, content, toolCall.id);
	}

	private _handleToolProgress(toolCall: IChatToolCall, result: IToolProgressUpdate): void {
		const label = formatToolLabel(toolCall.name);
		const content = result.content || '<empty result>';
		this._model.updateToolResult(label, content, toolCall.id);
	}
}



