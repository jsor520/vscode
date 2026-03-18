/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum XuanjiAiSettings {
	Model = 'xuanji.ai.model',
	MaxTokens = 'xuanji.ai.maxTokens',
	CompletionEnabled = 'xuanji.ai.completion.enabled',
	CompletionDebounceMs = 'xuanji.ai.completion.debounceMs',
	StripBrowserHeaders = 'xuanji.ai.stripBrowserHeaders',
	CustomModels = 'xuanji.ai.customModels',
	Credentials = 'xuanji.ai.credentials',
	ToolMaxCalls = 'xuanji.ai.tools.maxCalls',
	AutoApproveFileEdits = 'xuanji.ai.tools.autoApproveFileEdits',
}

export type ApiFormat = 'anthropic' | 'openai';

export const API_FORMAT_OPTIONS: { value: ApiFormat; label: string }[] = [
	{ value: 'anthropic', label: 'Anthropic Messages (Default)' },
	{ value: 'openai', label: 'OpenAI Chat Completions (Compatible)' },
];

export interface IAICredentialConfig {
	id: string;
	label: string;
	provider: string;
}

export interface ICustomModelConfig {
	id: string;
	name: string;
	provider: string;
	apiFormat: ApiFormat;
	apiBaseUrl: string;
	credentialId?: string;
	// Legacy compatibility field; removed after migration.
	apiKey?: string;
}
