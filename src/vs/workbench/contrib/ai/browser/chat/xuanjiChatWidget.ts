/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IXuanjiAgentTaskState } from '../agent/agentController.js';
import { IXuanjiChatMessage } from './xuanjiChatModel.js';
import { XuanjiChatInputWidget } from './xuanjiChatInputWidget.js';
import { XuanjiChatMessageRenderer } from './xuanjiChatMessageRenderer.js';
import { XuanjiChatService } from './xuanjiChatService.js';

export class XuanjiChatWidget extends Disposable {

	private readonly _messagesContainer: HTMLElement;
	private readonly _inputWidget: XuanjiChatInputWidget;
	private readonly _agentStatusContainer: HTMLElement;
	private readonly _planActionsContainer: HTMLElement;
	private readonly _messageRenderers = new Map<string, XuanjiChatMessageRenderer>();
	private readonly _messageRendererStore = this._register(new DisposableStore());

	constructor(
		container: HTMLElement,
		private readonly _chatService: XuanjiChatService,
		openerService: IOpenerService,
		quickInputService: IQuickInputService,
		workspaceService: IWorkspaceContextService,
		fileService: IFileService,
		configurationService: IConfigurationService,
		commandService: ICommandService,
	) {
		super();

		container.className = 'xuanji-chat-widget';

		this._messagesContainer = document.createElement('div');
		this._messagesContainer.className = 'xuanji-chat-messages';
		container.appendChild(this._messagesContainer);

		this._agentStatusContainer = document.createElement('div');
		this._agentStatusContainer.className = 'xuanji-chat-agent-status';
		this._agentStatusContainer.style.display = 'none';
		container.appendChild(this._agentStatusContainer);

		const stopContainer = document.createElement('div');
		stopContainer.className = 'xuanji-chat-stop-container';
		const stopButton = document.createElement('button');
		stopButton.className = 'xuanji-chat-stop-btn';
		stopButton.textContent = 'Stop generating';
		stopButton.style.display = 'none';
		stopButton.addEventListener('click', () => this._chatService.stopGeneration());
		stopContainer.appendChild(stopButton);
		container.appendChild(stopContainer);

		this._planActionsContainer = document.createElement('div');
		this._planActionsContainer.className = 'xuanji-chat-plan-actions';
		this._planActionsContainer.style.display = 'none';

		const planSummary = document.createElement('div');
		planSummary.className = 'xuanji-chat-plan-summary';
		planSummary.textContent = 'Plan ready for review';
		this._planActionsContainer.appendChild(planSummary);

		const planButtons = document.createElement('div');
		planButtons.className = 'xuanji-chat-plan-buttons';

		const runPlanButton = document.createElement('button');
		runPlanButton.className = 'xuanji-chat-plan-btn primary';
		runPlanButton.textContent = 'Run Plan';
		runPlanButton.addEventListener('click', () => {
			void this._chatService.executePendingPlan();
		});
		planButtons.appendChild(runPlanButton);

		const regeneratePlanButton = document.createElement('button');
		regeneratePlanButton.className = 'xuanji-chat-plan-btn';
		regeneratePlanButton.textContent = 'Regenerate';
		regeneratePlanButton.addEventListener('click', () => {
			void this._chatService.regeneratePlan();
		});
		planButtons.appendChild(regeneratePlanButton);

		this._planActionsContainer.appendChild(planButtons);
		container.appendChild(this._planActionsContainer);

		this._inputWidget = this._register(new XuanjiChatInputWidget(
			container,
			quickInputService,
			workspaceService,
			fileService,
			configurationService,
			commandService,
		));

		this._register(this._inputWidget.onDidSubmit(event => {
			void this._chatService.sendMessage(event.text, event.attachments);
		}));

		this._register(this._chatService.model.onDidAddMessage(message => {
			this._renderMessage(message, openerService);
			this._scrollToBottom();
		}));

		this._register(this._chatService.model.onDidChange(() => {
			for (const message of this._chatService.model.messages) {
				this._messageRenderers.get(message.id)?.update();
			}

			const hasPendingPlan = !!this._chatService.model.pendingPlan;
			this._renderAgentState(this._chatService.agentState);
			this._planActionsContainer.style.display = hasPendingPlan ? '' : 'none';
			runPlanButton.disabled = this._chatService.model.isGenerating;
			regeneratePlanButton.disabled = this._chatService.model.isGenerating;
			stopButton.style.display = this._chatService.model.isGenerating ? '' : 'none';
			this._inputWidget.setEnabled(!this._chatService.model.isGenerating);
			this._inputWidget.setPlanReviewState(hasPendingPlan);
			this._scrollToBottom();
		}));
		this._register(this._chatService.onDidChangeAgentState(() => {
			this._renderAgentState(this._chatService.agentState);
			this._scrollToBottom();
		}));

		this._showWelcome();
	}

	focus(): void {
		this._inputWidget.focus();
	}

	clearMessages(): void {
		this._messageRendererStore.clear();
		this._messagesContainer.textContent = '';
		this._messageRenderers.clear();
		this._agentStatusContainer.textContent = '';
		this._agentStatusContainer.style.display = 'none';
		this._showWelcome();
	}

	private _renderMessage(message: IXuanjiChatMessage, openerService: IOpenerService): void {
		const element = document.createElement('div');
		this._messagesContainer.appendChild(element);

		const renderer = this._messageRendererStore.add(new XuanjiChatMessageRenderer(element, message, openerService));
		this._messageRenderers.set(message.id, renderer);
	}

	private _scrollToBottom(): void {
		DOM.getWindow(this._messagesContainer).requestAnimationFrame(() => {
			this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
		});
	}

	private _showWelcome(): void {
		const welcome = document.createElement('div');
		welcome.className = 'xuanji-chat-welcome';

		const title = document.createElement('h3');
		title.textContent = 'Welcome to XuanJi AI';
		welcome.appendChild(title);

		const description = document.createElement('p');
		description.appendChild(document.createTextNode('Start a conversation here. Type '));
		const commandHint = document.createElement('code');
		commandHint.textContent = '@';
		description.appendChild(commandHint);
		description.appendChild(document.createTextNode(' to attach files as context.'));
		welcome.appendChild(description);

		this._messagesContainer.appendChild(welcome);
	}

	private _renderAgentState(state: IXuanjiAgentTaskState | undefined): void {
		this._agentStatusContainer.textContent = '';
		if (!state || state.status === 'idle') {
			this._agentStatusContainer.style.display = 'none';
			return;
		}

		this._agentStatusContainer.style.display = '';

		const header = document.createElement('div');
		header.className = 'xuanji-chat-agent-header';
		header.textContent = `${state.mode === 'plan' ? 'Plan Agent' : 'Agent'} · ${this._formatAgentStatus(state.status)}`;
		this._agentStatusContainer.appendChild(header);

		const task = document.createElement('div');
		task.className = 'xuanji-chat-agent-task';
		task.textContent = state.task;
		this._agentStatusContainer.appendChild(task);

		if (state.steps.length) {
			const steps = document.createElement('div');
			steps.className = 'xuanji-chat-agent-steps';
			for (const step of state.steps) {
				const stepElement = document.createElement('div');
				stepElement.className = `xuanji-chat-agent-step status-${step.status}`;
				stepElement.textContent = `${this._formatStepStatus(step.status)} ${step.title}`;
				steps.appendChild(stepElement);
			}
			this._agentStatusContainer.appendChild(steps);
		}

		if (state.pendingReview) {
			const review = document.createElement('div');
			review.className = 'xuanji-chat-agent-review';

			const summary = document.createElement('div');
			summary.className = 'xuanji-chat-agent-review-summary';
			summary.textContent = state.pendingReview.summary;
			review.appendChild(summary);

			const actions = document.createElement('div');
			actions.className = 'xuanji-chat-agent-review-actions';

			const reviewButton = document.createElement('button');
			reviewButton.className = 'xuanji-chat-plan-btn';
			reviewButton.textContent = 'Review';
			reviewButton.addEventListener('click', () => {
				void this._chatService.openAgentReview(state.pendingReview!.id);
			});
			actions.appendChild(reviewButton);

			const acceptButton = document.createElement('button');
			acceptButton.className = 'xuanji-chat-plan-btn primary';
			acceptButton.textContent = 'Accept';
			acceptButton.addEventListener('click', () => {
				void this._chatService.acceptAgentReview(state.pendingReview!.id);
			});
			actions.appendChild(acceptButton);

			const rejectButton = document.createElement('button');
			rejectButton.className = 'xuanji-chat-plan-btn';
			rejectButton.textContent = 'Reject';
			rejectButton.addEventListener('click', () => {
				this._chatService.rejectAgentReview(state.pendingReview!.id);
			});
			actions.appendChild(rejectButton);

			review.appendChild(actions);
			this._agentStatusContainer.appendChild(review);
		}

		if (state.errorMessage && state.status === 'error') {
			const error = document.createElement('div');
			error.className = 'xuanji-chat-agent-error';
			error.textContent = state.errorMessage;
			this._agentStatusContainer.appendChild(error);
		}
	}

	private _formatAgentStatus(status: IXuanjiAgentTaskState['status']): string {
		switch (status) {
			case 'running':
				return 'Running';
			case 'waiting_review':
				return 'Waiting for Review';
			case 'completed':
				return 'Completed';
			case 'stopped':
				return 'Stopped';
			case 'error':
				return 'Error';
			default:
				return 'Idle';
		}
	}

	private _formatStepStatus(status: string): string {
		switch (status) {
			case 'completed':
				return '✓';
			case 'failed':
				return '!';
			case 'in_progress':
				return '…';
			default:
				return '•';
		}
	}
}
