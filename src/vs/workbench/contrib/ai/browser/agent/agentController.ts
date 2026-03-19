/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { basename, dirname, relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IChatToolCall } from '../../../../../platform/ai/common/aiService.js';
import { XuanjiChatMode } from '../../../../../platform/ai/common/aiSettings.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IAgentFileReviewHandler, IAgentFileReviewRequest, IAgentFileReviewResult } from '../../common/agentReview.js';
import { XuanjiCheckpointService } from '../inlineEdit/xuanjiCheckpointService.js';

export type XuanjiAgentTaskStatus = 'idle' | 'running' | 'waiting_review' | 'completed' | 'stopped' | 'error';
export type XuanjiAgentStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface IXuanjiAgentStep {
	readonly id: string;
	readonly title: string;
	readonly status: XuanjiAgentStepStatus;
	readonly detail?: string;
}

export interface IXuanjiPendingFileReview {
	readonly id: string;
	readonly resource: URI;
	readonly label: string;
	readonly summary: string;
	readonly isNewFile: boolean;
}

export interface IXuanjiAgentFileChange {
	readonly id: string;
	readonly resource: URI;
	readonly label: string;
	readonly summary: string;
	readonly status: 'pending' | 'accepted' | 'rejected' | 'rolled_back';
}

export interface IXuanjiAgentCheckpointEntry {
	readonly id: string;
	readonly resource: URI;
	readonly label: string;
	readonly checkpointUri?: URI;
}

export interface IXuanjiAgentTaskState {
	readonly mode: XuanjiChatMode;
	readonly task: string;
	readonly status: XuanjiAgentTaskStatus;
	readonly steps: readonly IXuanjiAgentStep[];
	readonly files: readonly IXuanjiAgentFileChange[];
	readonly checkpoints: readonly IXuanjiAgentCheckpointEntry[];
	readonly pendingReview?: IXuanjiPendingFileReview;
	readonly errorMessage?: string;
}

interface IPendingReviewSession {
	readonly request: IAgentFileReviewRequest;
	resolve: (result: IAgentFileReviewResult) => void;
	readonly cancellationListener: { dispose(): void };
}

export const IXuanjiAgentService = createDecorator<IXuanjiAgentService>('xuanjiAgentService');

export interface IXuanjiAgentService extends IAgentFileReviewHandler {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<IXuanjiAgentTaskState | undefined>;
	readonly state: IXuanjiAgentTaskState | undefined;

	beginTask(mode: XuanjiChatMode, task: string): void;
	recordToolUse(toolCall: IChatToolCall): void;
	recordToolResult(toolCall: IChatToolCall, result: IAgentFileReviewResult): void;
	recordError(message: string): void;
	completeTask(): void;
	stopTask(): void;
	openPendingReview(id: string): Promise<void>;
	acceptPendingReview(id: string): Promise<void>;
	rejectPendingReview(id: string, message?: string): void;
	rollbackToCheckpoint(id: string): Promise<void>;
}

export class XuanjiAgentController extends Disposable implements IXuanjiAgentService {

	declare readonly _serviceBrand: undefined;
	private readonly _checkpointService: XuanjiCheckpointService;
	private readonly _onDidChangeState = this._register(new Emitter<IXuanjiAgentTaskState | undefined>());
	readonly onDidChangeState: Event<IXuanjiAgentTaskState | undefined> = this._onDidChangeState.event;

	private _state: IXuanjiAgentTaskState | undefined;
	private _pendingReviewSession: IPendingReviewSession | undefined;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._checkpointService = new XuanjiCheckpointService(_fileService, _workspaceService);
	}

	get state(): IXuanjiAgentTaskState | undefined {
		return this._state;
	}

	beginTask(mode: XuanjiChatMode, task: string): void {
		this._setState({
			mode,
			task,
			status: 'running',
			steps: [],
			files: [],
			checkpoints: [],
		});
	}

	recordToolUse(toolCall: IChatToolCall): void {
		if (!this._state) {
			return;
		}

		const nextStep: IXuanjiAgentStep = {
			id: toolCall.id || `${Date.now()}_${toolCall.name}`,
			title: toolCall.name,
			status: 'in_progress',
		};
		this._setState({
			...this._state,
			status: this._state.pendingReview ? 'waiting_review' : 'running',
			steps: [...this._state.steps, nextStep],
		});
	}

	recordToolResult(toolCall: IChatToolCall, result: IAgentFileReviewResult): void {
		if (!this._state) {
			return;
		}

		const toolStepId = toolCall.id || '';
		const steps: IXuanjiAgentStep[] = this._state.steps.map(step => step.id === toolStepId
			? {
				...step,
				status: result.isError ? 'failed' as const : 'completed' as const,
				detail: result.content,
			}
			: step);
		this._setState({
			...this._state,
			status: this._state.pendingReview ? 'waiting_review' : (result.isError ? 'error' : 'running'),
			errorMessage: result.isError ? result.content : this._state.errorMessage,
			steps,
		});
	}

	recordError(message: string): void {
		if (!this._state) {
			return;
		}

		this._setState({
			...this._state,
			status: 'error',
			errorMessage: message,
		});
	}

	completeTask(): void {
		if (!this._state || this._state.status === 'stopped') {
			return;
		}

		this._setState({
			...this._state,
			status: this._state.pendingReview ? 'waiting_review' : 'completed',
		});
	}

	stopTask(): void {
		if (!this._state) {
			return;
		}

		if (this._pendingReviewSession) {
			this._pendingReviewSession.resolve({
				content: 'The agent task was stopped before the file review was resolved.',
				isError: true,
			});
			this._pendingReviewSession.cancellationListener.dispose();
			this._pendingReviewSession = undefined;
		}

		this._setState({
			...this._state,
			status: 'stopped',
			pendingReview: undefined,
		});
	}

	async reviewFileChange(request: IAgentFileReviewRequest, token: CancellationToken): Promise<IAgentFileReviewResult> {
		if (!this._state) {
			return { content: 'Agent review is unavailable because no task is active.', isError: true };
		}

		if (this._pendingReviewSession) {
			return { content: 'Another file review is already pending.', isError: true };
		}

		try {
			let checkpointUri: URI | undefined;
			if (!request.isNewFile) {
				checkpointUri = await this._checkpointService.saveCheckpoint(request.resource, request.originalContent);
			}
			await this._openReviewDiff(request);
			this._setState({
				...this._state,
				checkpoints: checkpointUri ? [
					...this._state.checkpoints,
					{
						id: request.id,
						resource: request.resource,
						label: request.label,
						checkpointUri,
					},
				] : this._state.checkpoints,
			});
		} catch (error) {
			this._logService.error('[XuanJi AI] Failed to open agent review diff.', error);
			return { content: error instanceof Error ? error.message : String(error), isError: true };
		}

		this._setState({
			...this._state,
			status: 'waiting_review',
			files: this._upsertFileChange(this._state.files, {
				id: request.id,
				resource: request.resource,
				label: request.label,
				summary: request.summary,
				status: 'pending',
			}),
			pendingReview: {
				id: request.id,
				resource: request.resource,
				label: request.label,
				summary: request.summary,
				isNewFile: request.isNewFile,
			},
		});

		return await new Promise<IAgentFileReviewResult>(resolve => {
			const cancellationListener = token.onCancellationRequested(() => {
				this.rejectPendingReview(request.id, 'The agent task was cancelled before this change was reviewed.');
			});

			this._pendingReviewSession = {
				request,
				resolve: result => {
					resolve(result);
				},
				cancellationListener,
			};
		});
	}

	async openPendingReview(id: string): Promise<void> {
		if (!this._pendingReviewSession || this._pendingReviewSession.request.id !== id) {
			return;
		}

		await this._openReviewDiff(this._pendingReviewSession.request);
	}

	async acceptPendingReview(id: string): Promise<void> {
		if (!this._pendingReviewSession || this._pendingReviewSession.request.id !== id) {
			return;
		}

		const review = this._pendingReviewSession;
		this._pendingReviewSession = undefined;
		review.cancellationListener.dispose();

		await this._ensureParentDirectory(review.request.resource);
		await this._fileService.writeFile(review.request.resource, VSBuffer.fromString(review.request.modifiedContent));
		await this._editorService.openEditor({ resource: review.request.resource, options: { pinned: true, preserveFocus: true } });

		review.resolve({
			content: `${review.request.summary}\n\nThe user approved the change and it has been applied to ${review.request.label}.`,
		});
		this._setState(this._state ? {
			...this._state,
			status: 'running',
			files: this._upsertFileChange(this._state.files, {
				id: review.request.id,
				resource: review.request.resource,
				label: review.request.label,
				summary: review.request.summary,
				status: 'accepted',
			}),
			pendingReview: undefined,
		} : undefined);
	}

	rejectPendingReview(id: string, message?: string): void {
		if (!this._pendingReviewSession || this._pendingReviewSession.request.id !== id) {
			return;
		}

		const review = this._pendingReviewSession;
		this._pendingReviewSession = undefined;
		review.cancellationListener.dispose();
		review.resolve({
			content: message || `The user rejected the proposed change for ${review.request.label}.`,
			isError: true,
		});
		this._setState(this._state ? {
			...this._state,
			status: 'running',
			files: this._upsertFileChange(this._state.files, {
				id: review.request.id,
				resource: review.request.resource,
				label: review.request.label,
				summary: review.request.summary,
				status: 'rejected',
			}),
			pendingReview: undefined,
		} : undefined);
	}

	async rollbackToCheckpoint(id: string): Promise<void> {
		if (!this._state) {
			return;
		}

		const checkpoint = this._state.checkpoints.find(entry => entry.id === id && entry.checkpointUri);
		if (!checkpoint?.checkpointUri) {
			return;
		}

		try {
			await this._checkpointService.restoreCheckpoint(checkpoint.resource, checkpoint.checkpointUri);
			await this._editorService.openEditor({ resource: checkpoint.resource, options: { pinned: true, preserveFocus: true } });
			this._setState({
				...this._state,
				files: this._upsertFileChange(this._state.files, {
					id: checkpoint.id,
					resource: checkpoint.resource,
					label: checkpoint.label,
					summary: `Rolled back to checkpoint ${basename(checkpoint.checkpointUri)}.`,
					status: 'rolled_back',
				}),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._logService.error('[XuanJi AI] Failed to restore checkpoint.', error);
			this._setState({
				...this._state,
				errorMessage: message,
			});
		}
	}

	private async _openReviewDiff(request: IAgentFileReviewRequest): Promise<void> {
		const firstLine = request.modifiedContent.split(/\r?\n/, 1)[0];
		const languageId = this._languageService.guessLanguageIdByFilepathOrFirstLine(request.resource, firstLine) || undefined;
		const label = `${basename(request.resource)} (Agent Review)`;
		const description = this._formatResource(request.resource);

		await this._editorService.openEditor({
			label,
			description,
			original: {
				resource: undefined,
				contents: request.originalContent,
				languageId,
			},
			modified: {
				resource: undefined,
				contents: request.modifiedContent,
				languageId,
			},
			options: {
				pinned: true,
			},
		});
	}

	private _formatResource(resource: URI): string {
		const workspaceFolder = this._workspaceService.getWorkspaceFolder(resource);
		if (!workspaceFolder) {
			return resource.scheme === 'file' ? resource.fsPath : resource.toString();
		}

		const relative = relativePath(workspaceFolder.uri, resource);
		if (!relative) {
			return workspaceFolder.name;
		}

		return this._workspaceService.getWorkspace().folders.length > 1
			? `${workspaceFolder.name}/${relative}`
			: relative;
	}

	private async _ensureParentDirectory(resource: URI): Promise<void> {
		const parent = dirname(resource);
		if (parent.toString() === resource.toString()) {
			return;
		}
		if (await this._fileService.exists(parent)) {
			return;
		}
		await this._fileService.createFolder(parent);
	}

	private _setState(state: IXuanjiAgentTaskState | undefined): void {
		this._state = state;
		this._onDidChangeState.fire(this._state);
	}

	private _upsertFileChange(files: readonly IXuanjiAgentFileChange[], next: IXuanjiAgentFileChange): IXuanjiAgentFileChange[] {
		const existingIndex = files.findIndex(file => file.id === next.id);
		if (existingIndex === -1) {
			return [...files, next];
		}

		const copy = [...files];
		copy[existingIndex] = next;
		return copy;
	}
}
