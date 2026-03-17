/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { InlineCompletionContext, InlineCompletions, InlineCompletionsProvider, InlineCompletionsDisposeReason } from '../../../../editor/common/languages.js';
import { IAIService } from '../../../../platform/ai/common/aiService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { XuanjiAiSettings } from '../../../../platform/ai/common/aiSettings.js';
import { collectCompletionContext } from '../common/contextCollector.js';

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class XuanjiInlineCompletionsProvider implements InlineCompletionsProvider {

	readonly groupId = 'xuanji-ai-inline-completions';

	get debounceDelayMs(): number {
		return this._configService.getValue<number>(XuanjiAiSettings.CompletionDebounceMs) || 500;
	}

	constructor(
		private readonly _aiService: IAIService,
		private readonly _configService: IConfigurationService,
		private readonly _logService: ILogService,
	) { }

	async provideInlineCompletions(
		model: ITextModel,
		position: Position,
		_context: InlineCompletionContext,
		token: CancellationToken,
	): Promise<InlineCompletions | undefined> {

		if (!this._configService.getValue<boolean>(XuanjiAiSettings.CompletionEnabled)) {
			return undefined;
		}

		const lineContent = model.getLineContent(position.lineNumber);
		if (!lineContent.trim() && position.column === 1) {
			return undefined;
		}

		if (token.isCancellationRequested) {
			return undefined;
		}

		try {
			const completionContext = collectCompletionContext(model, position);
			const results = await this._aiService.complete(completionContext);

			if (token.isCancellationRequested || results.length === 0) {
				return undefined;
			}

			return {
				items: results.map(r => ({
					insertText: r.text,
					range: r.range
						? new Range(r.range.startLine, r.range.startColumn, r.range.endLine, r.range.endColumn)
						: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
				})),
			};
		} catch (error) {
			this._logService.debug('[XuanJi AI] Inline completion failed.', getErrorMessage(error));
			return undefined;
		}
	}

	freeInlineCompletions(): void {
		// no-op
	}

	disposeInlineCompletions(_completions: InlineCompletions, _reason: InlineCompletionsDisposeReason): void {
		// no-op
	}
}
