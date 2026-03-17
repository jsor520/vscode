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
import { IXuanjiChatMessage } from './xuanjiChatModel.js';
import { XuanjiChatInputWidget } from './xuanjiChatInputWidget.js';
import { XuanjiChatMessageRenderer } from './xuanjiChatMessageRenderer.js';
import { XuanjiChatService } from './xuanjiChatService.js';

export class XuanjiChatWidget extends Disposable {

	private readonly _messagesContainer: HTMLElement;
	private readonly _inputWidget: XuanjiChatInputWidget;
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

		const stopContainer = document.createElement('div');
		stopContainer.className = 'xuanji-chat-stop-container';
		const stopButton = document.createElement('button');
		stopButton.className = 'xuanji-chat-stop-btn';
		stopButton.textContent = 'Stop generating';
		stopButton.style.display = 'none';
		stopButton.addEventListener('click', () => this._chatService.stopGeneration());
		stopContainer.appendChild(stopButton);
		container.appendChild(stopContainer);

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

			stopButton.style.display = this._chatService.model.isGenerating ? '' : 'none';
			this._inputWidget.setEnabled(!this._chatService.model.isGenerating);
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
}
