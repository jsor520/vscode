/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IChatMessage, IContextAttachment } from '../../../../../platform/ai/common/aiService.js';

export type XuanjiChatMessageKind = 'message' | 'thinking' | 'tool_use' | 'tool_result' | 'error';

export interface IXuanjiChatMessage {
	readonly id: string;
	readonly role: 'user' | 'assistant' | 'system';
	readonly kind: XuanjiChatMessageKind;
	content: string;
	readonly label?: string;
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
			kind: 'message',
			content,
			attachments,
			isStreaming: false,
		};
		this._messages.push(msg);
		this._onDidAddMessage.fire(msg);
		this._onDidChange.fire();
		return msg;
	}

	startGeneration(): void {
		if (this._isGenerating) {
			return;
		}

		this._isGenerating = true;
		this._onDidChange.fire();
	}

	appendToLastAssistant(text: string): void {
		this._appendToAssistantMessage('message', text);
	}

	appendThinking(text: string): void {
		this._appendToAssistantMessage('thinking', text, 'Reasoning');
	}

	addToolUse(label: string, content: string): void {
		this._pushAssistantEvent('tool_use', content, label);
	}

	addToolResult(label: string, content: string): void {
		this._pushAssistantEvent('tool_result', content, label);
	}

	addError(content: string): void {
		this._pushAssistantEvent('error', content, 'Error');
	}

	finishGeneration(): void {
		for (const message of this._messages) {
			if (message.role === 'assistant' && message.isStreaming) {
				message.isStreaming = false;
			}
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
		return this._messages
			.filter(message => message.kind === 'message')
			.map(m => ({
				role: m.role,
				content: m.content,
				attachments: m.attachments,
			}));
	}

	private _appendToAssistantMessage(kind: XuanjiChatMessageKind, text: string, label?: string): void {
		this._isGenerating = true;

		const last = this._messages[this._messages.length - 1];
		if (last && last.role === 'assistant' && last.kind === kind && last.isStreaming) {
			last.content += text;
		} else {
			const message: IXuanjiChatMessage = {
				id: this._generateId(),
				role: 'assistant',
				kind,
				label,
				content: text,
				isStreaming: true,
			};
			this._messages.push(message);
			this._onDidAddMessage.fire(message);
		}
		this._onDidChange.fire();
	}

	private _pushAssistantEvent(kind: Exclude<XuanjiChatMessageKind, 'message' | 'thinking'>, content: string, label: string): void {
		this._messages.push({
			id: this._generateId(),
			role: 'assistant',
			kind,
			label,
			content,
			isStreaming: false,
		});
		this._onDidAddMessage.fire(this._messages[this._messages.length - 1]);
		this._onDidChange.fire();
	}

	private _generateId(): string {
		return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}
}
