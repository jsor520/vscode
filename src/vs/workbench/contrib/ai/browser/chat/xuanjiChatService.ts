/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IAIService, IChatOptions, IContextAttachment } from '../../../../../platform/ai/common/aiService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { XuanjiAiSettings } from '../../../../../platform/ai/common/aiSettings.js';
import { XuanjiChatModel } from './xuanjiChatModel.js';

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class XuanjiChatService extends Disposable {

	private readonly _model = this._register(new XuanjiChatModel());
	private _currentCancellationTokenSource: CancellationTokenSource | undefined;

	constructor(
		private readonly _aiService: IAIService,
		private readonly _configurationService: IConfigurationService,
		private readonly _rulesProvider?: { collectRules(): Promise<string> },
	) {
		super();
	}

	get model(): XuanjiChatModel {
		return this._model;
	}

	async sendMessage(content: string, attachments?: IContextAttachment[]): Promise<void> {
		this.stopGeneration();
		this._model.addUserMessage(content, attachments);

		const cancellationTokenSource = new CancellationTokenSource();
		this._currentCancellationTokenSource = cancellationTokenSource;

		try {
			const messages = this._model.toChatMessages();
			this._model.addAssistantMessage();

			if (this._rulesProvider) {
				try {
					const rules = await this._rulesProvider.collectRules();
					if (rules) {
						messages.unshift({ role: 'system', content: rules });
					}
				} catch {
					// Ignore rules loading failures for chat requests.
				}
			}

			const options: IChatOptions = {
				model: this._configurationService.getValue<string>(XuanjiAiSettings.Model) || undefined,
				maxTokens: this._configurationService.getValue<number>(XuanjiAiSettings.MaxTokens) || undefined,
			};

			for await (const chunk of this._aiService.chat(messages, options)) {
				if (cancellationTokenSource.token.isCancellationRequested) {
					break;
				}

				if (chunk.type === 'text') {
					this._model.appendToLastAssistant(chunk.content);
				} else if (chunk.type === 'error') {
					this._model.appendToLastAssistant(`\n\n**Error**: ${chunk.content}`);
				}
			}
		} catch (error) {
			this._model.appendToLastAssistant(`\n\n**Error**: ${getErrorMessage(error)}`);
		} finally {
			this._model.finishGeneration();
			if (this._currentCancellationTokenSource === cancellationTokenSource) {
				this._currentCancellationTokenSource = undefined;
			}
			cancellationTokenSource.dispose();
		}
	}

	stopGeneration(): void {
		if (!this._currentCancellationTokenSource) {
			return;
		}

		this._currentCancellationTokenSource.cancel();
		this._currentCancellationTokenSource = undefined;
		this._model.finishGeneration();
	}

	clearHistory(): void {
		this.stopGeneration();
		this._model.clear();
	}
}
