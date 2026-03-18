/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAIService = createDecorator<IAIService>('aiService');

export interface IChatToolCall {
	id?: string;
	name: string;
	input: unknown;
}

export interface IChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	attachments?: IContextAttachment[];
	toolCallId?: string;
	toolName?: string;
	toolCalls?: IChatToolCall[];
}

export interface IContextAttachment {
	type: 'file' | 'selection' | 'terminal' | 'web';
	name: string;
	content: string;
}

export interface IChatChunk {
	type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'error' | 'done';
	content: string;
	toolCallId?: string;
	toolName?: string;
	toolInput?: unknown;
}

export interface IChatOptions {
	model?: string;
	maxTokens?: number;
	temperature?: number;
	tools?: ITool[];
}

export interface ITool {
	name: string;
	description: string;
	inputSchema: object;
}

export interface ICompletionContext {
	fileUri: string;
	position: { line: number; column: number };
	prefix: string;
	suffix: string;
	language: string;
}

export interface ICompletionResult {
	text: string;
	range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

export interface IAIProvider {
	readonly id: string;
	readonly name: string;
	readonly models: string[];
}

export interface IAIService {
	readonly _serviceBrand: undefined;

	chat(messages: IChatMessage[], options: IChatOptions, token?: CancellationToken): AsyncIterable<IChatChunk>;
	complete(context: ICompletionContext): Promise<ICompletionResult[]>;
	embed(text: string): Promise<number[]>;
	getActiveProvider(): IAIProvider;
	setActiveProvider(id: string): void;
	listProviders(): IAIProvider[];
}