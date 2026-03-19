/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IXuanjiAgentService, IXuanjiAgentTaskState } from './agentController.js';

export class XuanjiAgentWidget extends Disposable {

	constructor(
		private readonly _container: HTMLElement,
		private readonly _agentService: IXuanjiAgentService,
		private readonly _openerService: IOpenerService,
	) {
		super();

		this._container.className = 'xuanji-agent-widget';
		this._register(this._agentService.onDidChangeState(state => this._render(state)));
		this._render(this._agentService.state);
	}

	private _render(state: IXuanjiAgentTaskState | undefined): void {
		this._container.textContent = '';

		if (!state || state.status === 'idle') {
			this._renderEmptyState();
			return;
		}

		const header = document.createElement('div');
		header.className = 'xuanji-agent-panel-header';
		header.textContent = `${state.mode === 'plan' ? localize('xuanjiAgent.planMode', 'Plan Agent') : localize('xuanjiAgent.agentMode', 'Agent')} · ${this._formatStatus(state)}`;
		this._container.appendChild(header);

		const task = document.createElement('div');
		task.className = 'xuanji-agent-panel-task';
		task.textContent = state.task;
		this._container.appendChild(task);

		const actions = document.createElement('div');
		actions.className = 'xuanji-agent-panel-actions';

		const pauseButton = document.createElement('button');
		pauseButton.className = 'xuanji-agent-btn';
		pauseButton.textContent = state.isPaused ? localize('xuanjiAgent.resume', 'Resume') : localize('xuanjiAgent.pause', 'Pause');
		pauseButton.disabled = state.status === 'completed' || state.status === 'stopped' || state.status === 'error';
		pauseButton.addEventListener('click', () => {
			if (state.isPaused) {
				this._agentService.resumeTask();
			} else {
				this._agentService.pauseTask();
			}
		});
		actions.appendChild(pauseButton);

		const stopButton = document.createElement('button');
		stopButton.className = 'xuanji-agent-btn';
		stopButton.textContent = localize('xuanjiAgent.stop', 'Stop');
		stopButton.disabled = state.status === 'completed' || state.status === 'stopped' || state.status === 'error';
		stopButton.addEventListener('click', () => this._agentService.requestStop());
		actions.appendChild(stopButton);

		const rollbackLatestButton = document.createElement('button');
		rollbackLatestButton.className = 'xuanji-agent-btn';
		rollbackLatestButton.textContent = localize('xuanjiAgent.rollbackLatest', 'Rollback Latest');
		rollbackLatestButton.disabled = state.checkpoints.length === 0;
		rollbackLatestButton.addEventListener('click', () => {
			const latestCheckpoint = state.checkpoints.at(-1);
			if (latestCheckpoint) {
				void this._agentService.rollbackToCheckpoint(latestCheckpoint.id);
			}
		});
		actions.appendChild(rollbackLatestButton);

		this._container.appendChild(actions);

		if (state.pendingReview) {
			const reviewCard = document.createElement('div');
			reviewCard.className = 'xuanji-agent-review-card';

			const reviewTitle = document.createElement('div');
			reviewTitle.className = 'xuanji-agent-section-title';
			reviewTitle.textContent = localize('xuanjiAgent.pendingReview', 'Pending Review');
			reviewCard.appendChild(reviewTitle);

			const summary = document.createElement('div');
			summary.className = 'xuanji-agent-review-summary';
			summary.textContent = state.pendingReview.summary;
			reviewCard.appendChild(summary);

			const reviewActions = document.createElement('div');
			reviewActions.className = 'xuanji-agent-panel-actions';

			const reviewButton = document.createElement('button');
			reviewButton.className = 'xuanji-agent-btn';
			reviewButton.textContent = localize('xuanjiAgent.review', 'Review');
			reviewButton.addEventListener('click', () => {
				void this._agentService.openPendingReview(state.pendingReview!.id);
			});
			reviewActions.appendChild(reviewButton);

			const acceptButton = document.createElement('button');
			acceptButton.className = 'xuanji-agent-btn primary';
			acceptButton.textContent = localize('xuanjiAgent.accept', 'Accept');
			acceptButton.addEventListener('click', () => {
				void this._agentService.acceptPendingReview(state.pendingReview!.id);
			});
			reviewActions.appendChild(acceptButton);

			const rejectButton = document.createElement('button');
			rejectButton.className = 'xuanji-agent-btn';
			rejectButton.textContent = localize('xuanjiAgent.reject', 'Reject');
			rejectButton.addEventListener('click', () => {
				this._agentService.rejectPendingReview(state.pendingReview!.id);
			});
			reviewActions.appendChild(rejectButton);

			reviewCard.appendChild(reviewActions);
			this._container.appendChild(reviewCard);
		}

		if (state.steps.length) {
			const section = this._createSection(localize('xuanjiAgent.steps', 'Steps'));
			for (const step of state.steps) {
				const row = document.createElement('div');
				row.className = `xuanji-agent-list-row status-${step.status}`;
				row.textContent = `${this._formatStepStatus(step.status)} ${step.title}`;
				section.appendChild(row);
			}
			this._container.appendChild(section);
		}

		if (state.files.length) {
			const section = this._createSection(localize('xuanjiAgent.modifiedFiles', 'Modified Files'));
			for (const file of state.files) {
				const row = document.createElement('button');
				row.className = `xuanji-agent-file-row status-${file.status}`;
				row.type = 'button';
				row.title = localize('xuanjiAgent.openFile', 'Open file');
				row.addEventListener('click', () => {
					void this._openerService.open(file.resource);
				});

				const label = document.createElement('div');
				label.className = 'xuanji-agent-file-label';
				label.textContent = `${file.label} · ${this._formatFileStatus(file.status)}`;
				row.appendChild(label);

				const summary = document.createElement('div');
				summary.className = 'xuanji-agent-file-summary';
				summary.textContent = file.summary;
				row.appendChild(summary);

				section.appendChild(row);
			}
			this._container.appendChild(section);
		}

		if (state.checkpoints.length) {
			const section = this._createSection(localize('xuanjiAgent.checkpoints', 'Checkpoints'));
			for (const checkpoint of state.checkpoints) {
				const row = document.createElement('div');
				row.className = 'xuanji-agent-checkpoint-row';

				const openButton = document.createElement('button');
				openButton.className = 'xuanji-agent-link-btn';
				openButton.type = 'button';
				openButton.textContent = checkpoint.label;
				openButton.addEventListener('click', () => {
					if (checkpoint.checkpointUri) {
						void this._openerService.open(checkpoint.checkpointUri);
					}
				});
				row.appendChild(openButton);

				const rollbackButton = document.createElement('button');
				rollbackButton.className = 'xuanji-agent-btn';
				rollbackButton.type = 'button';
				rollbackButton.textContent = localize('xuanjiAgent.rollback', 'Rollback');
				rollbackButton.disabled = !checkpoint.checkpointUri;
				rollbackButton.addEventListener('click', () => {
					void this._agentService.rollbackToCheckpoint(checkpoint.id);
				});
				row.appendChild(rollbackButton);

				section.appendChild(row);
			}
			this._container.appendChild(section);
		}

		if (state.errorMessage) {
			const error = document.createElement('div');
			error.className = 'xuanji-agent-error';
			error.textContent = state.errorMessage;
			this._container.appendChild(error);
		}
	}

	private _createSection(title: string): HTMLElement {
		const section = document.createElement('div');
		section.className = 'xuanji-agent-section';

		const titleElement = document.createElement('div');
		titleElement.className = 'xuanji-agent-section-title';
		titleElement.textContent = title;
		section.appendChild(titleElement);

		return section;
	}

	private _renderEmptyState(): void {
		const empty = document.createElement('div');
		empty.className = 'xuanji-agent-empty';

		const title = document.createElement('h3');
		title.textContent = localize('xuanjiAgent.emptyTitle', 'No Active Agent Task');
		empty.appendChild(title);

		const description = document.createElement('p');
		description.textContent = localize('xuanjiAgent.emptyDescription', 'Start a task in Agent or Plan mode from the XuanJi chat panel to see progress here.');
		empty.appendChild(description);

		this._container.appendChild(empty);
	}

	private _formatStatus(state: IXuanjiAgentTaskState): string {
		if (state.status !== 'error' && state.status !== 'stopped' && state.status !== 'completed' && state.isPaused) {
			return localize('xuanjiAgent.statusPaused', 'Paused');
		}

		const status = state.status;
		switch (status) {
			case 'running':
				return localize('xuanjiAgent.statusRunning', 'Running');
			case 'waiting_review':
				return localize('xuanjiAgent.statusWaitingReview', 'Waiting for Review');
			case 'completed':
				return localize('xuanjiAgent.statusCompleted', 'Completed');
			case 'stopped':
				return localize('xuanjiAgent.statusStopped', 'Stopped');
			case 'error':
				return localize('xuanjiAgent.statusError', 'Error');
			default:
				return localize('xuanjiAgent.statusIdle', 'Idle');
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

	private _formatFileStatus(status: 'pending' | 'accepted' | 'rejected' | 'rolled_back'): string {
		switch (status) {
			case 'accepted':
				return localize('xuanjiAgent.fileStatusAccepted', 'Accepted');
			case 'rejected':
				return localize('xuanjiAgent.fileStatusRejected', 'Rejected');
			case 'rolled_back':
				return localize('xuanjiAgent.fileStatusRolledBack', 'Rolled Back');
			default:
				return localize('xuanjiAgent.fileStatusPending', 'Pending');
		}
	}
}
