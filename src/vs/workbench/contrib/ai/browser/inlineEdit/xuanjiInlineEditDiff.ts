/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor, IViewZone } from '../../../../../editor/browser/editorBrowser.js';
import { IModelDeltaDecoration } from '../../../../../editor/common/model.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';

export interface IDiffChange {
	type: 'add' | 'delete' | 'modify';
	originalStartLine: number;
	originalEndLine: number;
	modifiedStartLine: number;
	modifiedEndLine: number;
	addedLines?: string[];
	deletedLines?: string[];
}

export class XuanjiInlineEditDiffRenderer extends Disposable {

	private readonly _decorations = this._editor.createDecorationsCollection();
	private readonly _zoneDisposables = this._register(new DisposableStore());

	constructor(
		private readonly _editor: ICodeEditor,
	) {
		super();
	}

	renderDiff(changes: readonly IDiffChange[]): void {
		this.clearDiff();

		const decorations: IModelDeltaDecoration[] = [];
		const zones: IViewZone[] = [];

		for (const change of changes) {
			if (change.type === 'add' || change.type === 'modify') {
				for (let lineNumber = change.modifiedStartLine; lineNumber <= change.modifiedEndLine; lineNumber++) {
					decorations.push({
						range: {
							startLineNumber: lineNumber,
							startColumn: 1,
							endLineNumber: lineNumber,
							endColumn: Number.MAX_SAFE_INTEGER,
						},
						options: {
							isWholeLine: true,
							className: 'xuanji-diff-added-line',
							description: 'xuanji-inline-edit-added',
						},
					});
				}
			}

			if ((change.type === 'delete' || change.type === 'modify') && change.deletedLines?.length) {
				const zoneNode = document.createElement('div');
				zoneNode.className = 'xuanji-diff-deleted-zone';
				for (const line of change.deletedLines) {
					const lineElement = document.createElement('div');
					lineElement.className = 'xuanji-diff-deleted-line';
					lineElement.textContent = line || ' ';
					zoneNode.appendChild(lineElement);
				}

				zones.push({
					afterLineNumber: Math.max(1, change.modifiedStartLine - 1),
					heightInLines: change.deletedLines.length,
					domNode: zoneNode,
				});
			}
		}

		this._decorations.set(decorations);
		if (zones.length > 0) {
			this._editor.changeViewZones(accessor => {
				for (const zone of zones) {
					const zoneId = accessor.addZone(zone);
					this._zoneDisposables.add({
						dispose: () => {
							this._editor.changeViewZones(zoneAccessor => {
								zoneAccessor.removeZone(zoneId);
							});
						},
					});
				}
			});
		}
	}

	renderActionButtons(
		afterLine: number,
		onAccept: () => void,
		onReject: () => void,
	): void {
		const actionsNode = document.createElement('div');
		actionsNode.className = 'xuanji-diff-actions';

		const acceptButton = document.createElement('button');
		acceptButton.className = 'xuanji-diff-accept-btn';
		acceptButton.textContent = 'Accept (Ctrl+Enter)';
		acceptButton.addEventListener('click', onAccept);
		actionsNode.appendChild(acceptButton);

		const rejectButton = document.createElement('button');
		rejectButton.className = 'xuanji-diff-reject-btn';
		rejectButton.textContent = 'Reject (Esc)';
		rejectButton.addEventListener('click', onReject);
		actionsNode.appendChild(rejectButton);

		this._editor.changeViewZones(accessor => {
			const zoneId = accessor.addZone({
				afterLineNumber: afterLine,
				heightInLines: 1,
				domNode: actionsNode,
			});
			this._zoneDisposables.add({
				dispose: () => {
					this._editor.changeViewZones(zoneAccessor => {
						zoneAccessor.removeZone(zoneId);
					});
				},
			});
		});
	}

	clearDiff(): void {
		this._decorations.clear();
		this._zoneDisposables.clear();
	}

	override dispose(): void {
		this.clearDiff();
		super.dispose();
	}
}
