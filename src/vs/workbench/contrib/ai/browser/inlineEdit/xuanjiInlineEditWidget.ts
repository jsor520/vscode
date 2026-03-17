/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ZoneWidget } from '../../../../../editor/contrib/zoneWidget/browser/zoneWidget.js';

export interface IInlineEditSubmitEvent {
	readonly instruction: string;
}

export class XuanjiInlineEditWidget extends ZoneWidget {

	private _input: HTMLTextAreaElement | undefined;
	private _statusLabel: HTMLElement | undefined;

	private readonly _onDidSubmit = new Emitter<IInlineEditSubmitEvent>();
	readonly onDidSubmit: Event<IInlineEditSubmitEvent> = this._onDidSubmit.event;

	private readonly _onDidCancel = new Emitter<void>();
	readonly onDidCancel: Event<void> = this._onDidCancel.event;

	constructor(editor: ICodeEditor) {
		super(editor, {
			showFrame: true,
			showArrow: false,
			isResizeable: false,
			frameWidth: 1,
			isAccessible: true,
		});
	}

	protected override _fillContainer(container: HTMLElement): void {
		container.className = 'xuanji-inline-edit-widget';

		const header = document.createElement('div');
		header.className = 'xuanji-inline-edit-header';
		header.textContent = 'XuanJi AI Inline Edit';
		container.appendChild(header);

		const inputRow = document.createElement('div');
		inputRow.className = 'xuanji-inline-edit-input-row';

		this._input = document.createElement('textarea');
		this._input.className = 'xuanji-inline-edit-input';
		this._input.placeholder = 'Describe the change you want to make...';
		this._input.rows = 2;
		this._input.addEventListener('keydown', event => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				this._submit();
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				this._onDidCancel.fire();
			}
		});
		inputRow.appendChild(this._input);
		container.appendChild(inputRow);

		const buttonBar = document.createElement('div');
		buttonBar.className = 'xuanji-inline-edit-buttons';

		const sendButton = document.createElement('button');
		sendButton.className = 'xuanji-inline-edit-send';
		sendButton.textContent = 'Apply (Enter)';
		sendButton.addEventListener('click', () => this._submit());
		buttonBar.appendChild(sendButton);

		const cancelButton = document.createElement('button');
		cancelButton.className = 'xuanji-inline-edit-cancel';
		cancelButton.textContent = 'Cancel (Esc)';
		cancelButton.addEventListener('click', () => this._onDidCancel.fire());
		buttonBar.appendChild(cancelButton);

		container.appendChild(buttonBar);

		this._statusLabel = document.createElement('div');
		this._statusLabel.className = 'xuanji-inline-edit-status';
		container.appendChild(this._statusLabel);
	}

	showAtLine(lineNumber: number): void {
		super.show({ startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: 1 }, 5);
		if (this._input) {
			void DOM.getWindow(this._input).setTimeout(() => this._input?.focus(), 0);
		}
	}

	setStatus(text: string): void {
		if (this._statusLabel) {
			this._statusLabel.textContent = text;
		}
	}

	private _submit(): void {
		const instruction = this._input?.value.trim();
		if (instruction) {
			this._onDidSubmit.fire({ instruction });
		}
	}

	override dispose(): void {
		this._onDidSubmit.dispose();
		this._onDidCancel.dispose();
		super.dispose();
	}
}
