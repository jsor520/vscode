/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAIService, IChatMessage, IChatChunk, IChatOptions, ICompletionContext, ICompletionResult, IAIProvider } from './aiService.js';

const DESKTOP_REQUIRED_MSG = 'AI features require the desktop build of XuanJi IDE.';

/**
 * Browser-side stub implementation.
 * AI features are unavailable in web environments.
 */
export class BrowserAIServiceImpl implements IAIService {
	declare readonly _serviceBrand: undefined;

	async *chat(_messages: IChatMessage[], _options: IChatOptions): AsyncIterable<IChatChunk> {
		yield { type: 'error', content: DESKTOP_REQUIRED_MSG };
	}

	async complete(_context: ICompletionContext): Promise<ICompletionResult[]> {
		return [];
	}

	async embed(_text: string): Promise<number[]> {
		throw new Error(DESKTOP_REQUIRED_MSG);
	}

	getActiveProvider(): IAIProvider {
		return { id: 'none', name: 'None', models: [] };
	}

	setActiveProvider(_id: string): void {
		// no-op
	}

	listProviders(): IAIProvider[] {
		return [];
	}
}
