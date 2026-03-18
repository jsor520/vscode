/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { ILogService } from '../../log/common/log.js';
import { IAICredentialsService } from '../common/aiCredentialsService.js';
import { IAIProvider, IAIService, IChatChunk, IChatMessage, IChatOptions, ICompletionContext, ICompletionResult } from '../common/aiService.js';
import { ICustomModelConfig, XuanjiAiSettings } from '../common/aiSettings.js';
import { AnthropicClient } from './anthropicClient.js';
import { OpenAICompatClient } from './openaiCompatClient.js';

const DEFAULT_COMPLETION_MAX_TOKENS = 512;

function stripMarkdownCodeFence(value: string): string {
	let text = value.trim();
	const hasOpeningFence = /^```[\w-]*\s*\n?/.test(text);
	const hasClosingFence = /\n?```\s*$/.test(text);
	if (!hasOpeningFence || !hasClosingFence) {
		return text;
	}

	const openingFence = text.match(/^```[\w-]*\s*\n?/);
	if (openingFence) {
		text = text.slice(openingFence[0].length);
	}

	const closingFence = text.match(/\n?```\s*$/);
	if (closingFence) {
		text = text.slice(0, -closingFence[0].length);
	}

	return text.trim();
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface IAIClient {
	chatStream(messages: IChatMessage[], options: IChatOptions, token?: CancellationToken): AsyncIterable<IChatChunk>;
	complete(systemPrompt: string, userPrompt: string, options: IChatOptions, token?: CancellationToken): Promise<string>;
}

export class ElectronAIServiceImpl extends Disposable implements IAIService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly _configService: IConfigurationService,
		@IAICredentialsService private readonly _credentialsService: IAICredentialsService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	private async _getCurrentModelConfig(): Promise<ICustomModelConfig | undefined> {
		await this._credentialsService.migrateLegacyModelsIfNeeded();
		const modelId = this._configService.getValue<string>(XuanjiAiSettings.Model);
		if (!modelId) {
			return undefined;
		}

		const models = this._configService.getValue<ICustomModelConfig[]>(XuanjiAiSettings.CustomModels) || [];
		return models.find(model => model.id === modelId);
	}

	private async _getClient(): Promise<IAIClient> {
		const config = await this._getCurrentModelConfig();
		if (!config) {
			throw new Error('No model configured. Add one in XuanJi Settings > Models.');
		}

		let apiKey: string | undefined;
		if (config.credentialId) {
			apiKey = await this._credentialsService.getCredentialSecret(config.credentialId);
			if (!apiKey) {
				throw new Error(`The credential "${config.credentialId}" linked to model "${config.name}" has no stored secret.`);
			}
		}

		this._logService.info('[XuanJi AI] Creating AI client.', { apiFormat: config.apiFormat, apiBaseUrl: config.apiBaseUrl });
		if (config.apiFormat === 'openai') {
			return new OpenAICompatClient(apiKey, config.apiBaseUrl);
		}

		return new AnthropicClient(apiKey, config.apiBaseUrl);
	}

	private _getModel(): string {
		return this._configService.getValue<string>(XuanjiAiSettings.Model) || '';
	}

	private _getMaxTokens(): number {
		return this._configService.getValue<number>(XuanjiAiSettings.MaxTokens) || 4096;
	}

	async *chat(messages: IChatMessage[], options: IChatOptions, token?: CancellationToken): AsyncIterable<IChatChunk> {
		try {
			const client = await this._getClient();
			const mergedOptions: IChatOptions = {
				model: options.model || this._getModel(),
				maxTokens: options.maxTokens || this._getMaxTokens(),
				temperature: options.temperature,
				tools: options.tools,
			};

			this._logService.debug('[XuanJi AI] Chat request', { model: mergedOptions.model, messageCount: messages.length });
			yield* client.chatStream(messages, mergedOptions, token);
		} catch (error) {
			this._logService.error('[XuanJi AI] Chat request failed.', error);
			yield { type: 'error', content: getErrorMessage(error) };
		}
	}

	async complete(context: ICompletionContext): Promise<ICompletionResult[]> {
		try {
			const client = await this._getClient();
			const sanitize = (value: string) => value.replace(/[\u0000-\u001F\u007F-\u009F]/g, character => {
				if (character === '\n' || character === '\r' || character === '\t') {
					return character;
				}
				return ' ';
			});

			const systemPrompt = `You are a code completion assistant. Complete the code at the cursor using the surrounding context.
Return code only. Do not include explanations, markdown, or code fences.
Language: ${context.language}`;

			const userPrompt = `Complete the code at <CURSOR>.

${sanitize(context.prefix)}<CURSOR>${sanitize(context.suffix)}

Return only the code that should replace <CURSOR>.`;

			const result = await client.complete(
				systemPrompt,
				userPrompt,
				{
					model: this._getModel(),
					maxTokens: DEFAULT_COMPLETION_MAX_TOKENS,
					temperature: 0,
				},
				CancellationToken.None,
			);

			const text = stripMarkdownCodeFence(result);
			if (!text) {
				return [];
			}

			return [{ text }];
		} catch (error) {
			this._logService.error('[XuanJi AI] Code completion failed.', error);
			return [];
		}
	}

	async embed(_text: string): Promise<number[]> {
		throw new Error('Embeddings are not implemented yet.');
	}

	getActiveProvider(): IAIProvider {
		const modelId = this._configService.getValue<string>(XuanjiAiSettings.Model);
		const models = this._configService.getValue<ICustomModelConfig[]>(XuanjiAiSettings.CustomModels) || [];
		const config = models.find(model => model.id === modelId);
		return {
			id: config?.provider.toLowerCase() || 'none',
			name: config?.provider || 'None',
			models: config ? [config.id] : [],
		};
	}

	setActiveProvider(_id: string): void {
		// The selected model determines the active provider.
	}

	listProviders(): IAIProvider[] {
		const models = this._configService.getValue<ICustomModelConfig[]>(XuanjiAiSettings.CustomModels) || [];
		const providerMap = new Map<string, string[]>();
		for (const model of models) {
			const key = model.provider.toLowerCase();
			const modelIds = providerMap.get(key);
			if (modelIds) {
				modelIds.push(model.id);
			} else {
				providerMap.set(key, [model.id]);
			}
		}

		return Array.from(providerMap.entries()).map(([key, modelIds]) => ({
			id: key,
			name: models.find(model => model.provider.toLowerCase() === key)?.provider || key,
			models: modelIds,
		}));
	}
}