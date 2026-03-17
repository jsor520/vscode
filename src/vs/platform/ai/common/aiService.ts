/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAIService = createDecorator<IAIService>('aiService');

export interface IChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
	attachments?: IContextAttachment[];
}

export interface IContextAttachment {
	type: 'file' | 'selection' | 'terminal' | 'web';
	name: string;
	content: string;
}

export interface IChatChunk {
	type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'error' | 'done';
	content: string;
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

	chat(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IChatChunk>;
	complete(context: ICompletionContext): Promise<ICompletionResult[]>;
	embed(text: string): Promise<number[]>;
	getActiveProvider(): IAIProvider;
	setActiveProvider(id: string): void;
	listProviders(): IAIProvider[];
}
