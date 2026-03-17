/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { renderMarkdown } from '../../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable, IDisposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IXuanjiChatMessage } from './xuanjiChatModel.js';

export class XuanjiChatMessageRenderer extends Disposable {

	private _pendingUpdate = false;
	private _lastRenderedContent = '';
	private readonly _renderedMarkdown = this._register(new MutableDisposable<IDisposable>());

	constructor(
		private readonly _container: HTMLElement,
		private readonly _message: IXuanjiChatMessage,
		private readonly _openerService: IOpenerService,
	) {
		super();
		this._render();
	}

	update(): void {
		if (this._message.content === this._lastRenderedContent) {
			return;
		}

		if (!this._pendingUpdate) {
			this._pendingUpdate = true;
			DOM.getWindow(this._container).requestAnimationFrame(() => {
				this._pendingUpdate = false;
				this._render();
			});
		}
	}

	private _render(): void {
		this._lastRenderedContent = this._message.content;
		const isUser = this._message.role === 'user';

		this._container.className = `xuanji-chat-message ${isUser ? 'xuanji-chat-message-user' : 'xuanji-chat-message-assistant'}`;
		this._container.textContent = '';

		const roleLabel = document.createElement('div');
		roleLabel.className = 'xuanji-chat-message-role';
		roleLabel.textContent = isUser ? 'User' : 'XuanJi AI';
		this._container.appendChild(roleLabel);

		const contentElement = document.createElement('div');
		contentElement.className = 'xuanji-chat-message-content';

		if (this._message.content) {
			const markdown = new MarkdownString(this._message.content, { supportHtml: false, isTrusted: false });
			const rendered = renderMarkdown(markdown, {
				actionHandler: content => {
					void this._openerService.open(content, { allowCommands: false });
				},
			});
			contentElement.appendChild(rendered.element);
			this._renderedMarkdown.value = rendered;
		} else {
			this._renderedMarkdown.clear();
		}

		if (this._message.isStreaming) {
			const cursor = document.createElement('span');
			cursor.className = 'xuanji-chat-streaming-cursor';
			cursor.textContent = '|';
			contentElement.appendChild(cursor);
		}

		this._container.appendChild(contentElement);
	}
}
