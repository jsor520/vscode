/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../../editor/common/editorCommon.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IAIService, IChatMessage, IChatOptions } from '../../../../../platform/ai/common/aiService.js';
import { XuanjiAiSettings } from '../../../../../platform/ai/common/aiSettings.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { XuanjiCheckpointService } from './xuanjiCheckpointService.js';
import { IDiffChange, XuanjiInlineEditDiffRenderer } from './xuanjiInlineEditDiff.js';
import { XuanjiInlineEditWidget } from './xuanjiInlineEditWidget.js';

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function stripCodeFence(value: string): string {
	let text = value.trim();
	if (text.startsWith('```')) {
		const firstNewLine = text.indexOf('\n');
		if (firstNewLine !== -1) {
			text = text.substring(firstNewLine + 1);
		}
	}
	if (text.endsWith('```')) {
		text = text.substring(0, text.lastIndexOf('```')).trimEnd();
	}
	return text;
}

export class XuanjiInlineEditController extends Disposable implements IEditorContribution {

	static readonly ID = 'editor.contrib.xuanjiInlineEdit';

	private readonly _checkpointService: XuanjiCheckpointService;
	private readonly _sessionStore = this._register(new DisposableStore());

	private _widget: XuanjiInlineEditWidget | undefined;
	private _diffRenderer: XuanjiInlineEditDiffRenderer | undefined;
	private _pendingNewText: string | undefined;
	private _editRange: Range | undefined;

	static get(editor: ICodeEditor): XuanjiInlineEditController | null {
		return editor.getContribution<XuanjiInlineEditController>(XuanjiInlineEditController.ID);
	}

	constructor(
		private readonly _editor: ICodeEditor,
		@IAIService private readonly _aiService: IAIService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._checkpointService = new XuanjiCheckpointService(fileService, workspaceService);
	}

	start(): void {
		const selection = this._editor.getSelection();
		if (!selection) {
			return;
		}

		this._cleanup();

		const lineNumber = selection.startLineNumber;
		this._widget = new XuanjiInlineEditWidget(this._editor);
		this._sessionStore.add(this._widget);
		this._widget.showAtLine(lineNumber);

		this._sessionStore.add(this._widget.onDidSubmit(async event => {
			await this._handleSubmit(event.instruction, selection);
		}));
		this._sessionStore.add(this._widget.onDidCancel(() => {
			this._cleanup();
		}));
	}

	accept(): void {
		if (!this._pendingNewText || !this._editRange) {
			return;
		}

		this._editor.executeEdits('xuanji.inlineEdit', [{
			range: this._editRange,
			text: this._pendingNewText,
		}]);

		this._cleanup();
	}

	reject(): void {
		this._cleanup();
	}

	private async _handleSubmit(instruction: string, selection: Range): Promise<void> {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		this._widget?.setStatus('Generating edit...');
		await this._checkpointService.saveCheckpoint(model.uri, model.getValue());

		const editRange = new Range(
			selection.startLineNumber,
			1,
			selection.endLineNumber,
			model.getLineMaxColumn(selection.endLineNumber),
		);
		this._editRange = editRange;

		const selectedCode = model.getValueInRange(editRange);
		const beforeContext = this._getContextBefore(model, editRange.startLineNumber, 20);
		const afterContext = this._getContextAfter(model, editRange.endLineNumber, 20);

		const messages = this._createEditMessages(
			model.getLanguageId(),
			instruction,
			selectedCode,
			beforeContext,
			afterContext,
		);

		const options: IChatOptions = {
			model: this._configurationService.getValue<string>(XuanjiAiSettings.Model) || undefined,
			maxTokens: 4096,
			temperature: 0,
		};

		try {
			let newText = '';
			for await (const chunk of this._aiService.chat(messages, options)) {
				if (chunk.type === 'text') {
					newText += chunk.content;
				} else if (chunk.type === 'error') {
					this._widget?.setStatus(`Error: ${chunk.content}`);
					return;
				}
			}

			this._pendingNewText = stripCodeFence(newText);
			this._widget?.hide();

			this._diffRenderer = new XuanjiInlineEditDiffRenderer(this._editor);
			this._sessionStore.add(this._diffRenderer);

			const changes = this._computeSimpleDiff(selectedCode, this._pendingNewText, editRange.startLineNumber);
			this._diffRenderer.renderDiff(changes);
			this._diffRenderer.renderActionButtons(
				Math.max(editRange.endLineNumber, editRange.startLineNumber + this._pendingNewText.split('\n').length - 1),
				() => this.accept(),
				() => this.reject(),
			);

			this._widget?.setStatus('');
		} catch (error) {
			this._logService.error('[XuanJi AI] Inline edit failed.', error);
			this._widget?.setStatus(`Error: ${getErrorMessage(error)}`);
		}
	}

	private _createEditMessages(
		language: string,
		instruction: string,
		selectedCode: string,
		beforeContext: string,
		afterContext: string,
	): IChatMessage[] {
		return [
			{
				role: 'system',
				content: [
					'You are a code editing assistant.',
					'Return only the rewritten code for the selected block.',
					'Do not add explanations, markdown, or code fences.',
					`Language: ${language}`,
				].join('\n'),
			},
			{
				role: 'user',
				content: [
					'Context before the selection:',
					beforeContext || '(none)',
					'Selected code:',
					selectedCode,
					'Context after the selection:',
					afterContext || '(none)',
					`Instruction: ${instruction}`,
					'Return only the replacement text for the selected code.',
				].join('\n\n'),
			},
		];
	}

	private _getContextBefore(model: ITextModel, startLineNumber: number, maxLines: number): string {
		const fromLine = Math.max(1, startLineNumber - maxLines);
		const toLine = startLineNumber - 1;
		if (toLine < fromLine) {
			return '';
		}

		return model.getValueInRange(new Range(fromLine, 1, toLine, model.getLineMaxColumn(toLine)));
	}

	private _getContextAfter(model: ITextModel, endLineNumber: number, maxLines: number): string {
		const fromLine = endLineNumber + 1;
		const toLine = Math.min(model.getLineCount(), endLineNumber + maxLines);
		if (fromLine > toLine) {
			return '';
		}

		return model.getValueInRange(new Range(fromLine, 1, toLine, model.getLineMaxColumn(toLine)));
	}

	private _computeSimpleDiff(original: string, modified: string, startLineNumber: number): IDiffChange[] {
		if (original === modified) {
			return [];
		}

		const originalLines = original.split('\n');
		const modifiedLines = modified.split('\n');
		return [{
			type: 'modify',
			originalStartLine: startLineNumber,
			originalEndLine: startLineNumber + originalLines.length - 1,
			modifiedStartLine: startLineNumber,
			modifiedEndLine: startLineNumber + modifiedLines.length - 1,
			addedLines: modifiedLines,
			deletedLines: originalLines,
		}];
	}

	private _cleanup(): void {
		this._sessionStore.clear();
		this._widget = undefined;
		this._diffRenderer = undefined;
		this._pendingNewText = undefined;
		this._editRange = undefined;
	}

	override dispose(): void {
		this._cleanup();
		super.dispose();
	}
}
