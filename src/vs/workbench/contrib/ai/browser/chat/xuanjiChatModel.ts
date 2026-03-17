/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IChatMessage, IContextAttachment } from '../../../../../platform/ai/common/aiService.js';

export interface IXuanjiChatMessage {
	readonly id: string;
	readonly role: 'user' | 'assistant' | 'system';
	content: string;
	readonly attachments?: IContextAttachment[];
	isStreaming: boolean;
}

export class XuanjiChatModel extends Disposable {

	private readonly _messages: IXuanjiChatMessage[] = [];
	private _isGenerating = false;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidAddMessage = this._register(new Emitter<IXuanjiChatMessage>());
	readonly onDidAddMessage: Event<IXuanjiChatMessage> = this._onDidAddMessage.event;

	get messages(): readonly IXuanjiChatMessage[] {
		return this._messages;
	}

	get isGenerating(): boolean {
		return this._isGenerating;
	}

	addUserMessage(content: string, attachments?: IContextAttachment[]): IXuanjiChatMessage {
		const msg: IXuanjiChatMessage = {
			id: this._generateId(),
			role: 'user',
			content,
			attachments,
			isStreaming: false,
		};
		this._messages.push(msg);
		this._onDidAddMessage.fire(msg);
		this._onDidChange.fire();
		return msg;
	}

	addAssistantMessage(): IXuanjiChatMessage {
		const msg: IXuanjiChatMessage = {
			id: this._generateId(),
			role: 'assistant',
			content: '',
			isStreaming: true,
		};
		this._messages.push(msg);
		this._isGenerating = true;
		this._onDidAddMessage.fire(msg);
		this._onDidChange.fire();
		return msg;
	}

	appendToLastAssistant(text: string): void {
		const last = this._messages[this._messages.length - 1];
		if (last && last.role === 'assistant') {
			last.content += text;
			this._onDidChange.fire();
		}
	}

	finishGeneration(): void {
		const last = this._messages[this._messages.length - 1];
		if (last && last.role === 'assistant') {
			last.isStreaming = false;
		}
		this._isGenerating = false;
		this._onDidChange.fire();
	}

	clear(): void {
		this._messages.length = 0;
		this._isGenerating = false;
		this._onDidChange.fire();
	}

	toChatMessages(): IChatMessage[] {
		return this._messages.map(m => ({
			role: m.role,
			content: m.content,
			attachments: m.attachments,
		}));
	}

	private _generateId(): string {
		return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}
}
