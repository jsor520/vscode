/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { XuanjiAiSettings } from '../../../../../platform/ai/common/aiSettings.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'xuanji.ai',
	title: localize('xuanjiAi', "XuanJi AI"),
	type: 'object',
	properties: {
		[XuanjiAiSettings.Model]: {
			type: 'string',
			default: '',
			description: localize('xuanjiAi.model', "Selected AI model ID"),
			scope: ConfigurationScope.APPLICATION,
		},
		[XuanjiAiSettings.MaxTokens]: {
			type: 'number',
			default: 4096,
			minimum: 256,
			maximum: 32768,
			description: localize('xuanjiAi.maxTokens', "Maximum token count for AI responses"),
			scope: ConfigurationScope.APPLICATION,
		},
		[XuanjiAiSettings.ToolMaxCalls]: {
			type: 'number',
			default: 25,
			minimum: 1,
			maximum: 100,
			description: localize('xuanjiAi.tools.maxCalls', "Maximum number of AI tool calls allowed in a single chat task"),
			scope: ConfigurationScope.APPLICATION,
		},
		[XuanjiAiSettings.AutoApproveFileEdits]: {
			type: 'boolean',
			default: false,
			description: localize('xuanjiAi.tools.autoApproveFileEdits', "Skip confirmation dialogs for AI write_file and edit_file tools"),
			scope: ConfigurationScope.APPLICATION,
		},
		[XuanjiAiSettings.CompletionEnabled]: {
			type: 'boolean',
			default: true,
			description: localize('xuanjiAi.completion.enabled', "Enable AI code completion"),
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
		},
		[XuanjiAiSettings.CompletionDebounceMs]: {
			type: 'number',
			default: 500,
			minimum: 100,
			maximum: 3000,
			description: localize('xuanjiAi.completion.debounceMs', "Delay before code completion is triggered (ms)"),
			scope: ConfigurationScope.APPLICATION,
		},
		[XuanjiAiSettings.StripBrowserHeaders]: {
			type: 'boolean',
			default: true,
			description: localize('xuanjiAi.stripBrowserHeaders', "Remove browser headers from AI API requests to avoid proxy or CDN rejections"),
			scope: ConfigurationScope.APPLICATION,
		},
		[XuanjiAiSettings.CustomModels]: {
			type: 'array',
			default: [],
			description: localize('xuanjiAi.customModels', "User-defined models without secrets; secrets are stored in secure storage"),
			items: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'Model ID (e.g. claude-sonnet-4-6-20250514)' },
					name: { type: 'string', description: 'Display name' },
					provider: { type: 'string', description: 'Provider name (e.g. Anthropic, OpenAI)' },
					apiFormat: { type: 'string', enum: ['anthropic', 'openai'], description: 'API format' },
					apiBaseUrl: { type: 'string', description: 'API base URL' },
					credentialId: { type: 'string', description: 'Associated credential ID (optional)' },
					apiKey: { type: 'string', description: 'Legacy compatibility field removed after migration' },
				},
				required: ['id', 'name', 'provider', 'apiFormat', 'apiBaseUrl'],
			},
			scope: ConfigurationScope.APPLICATION,
		},
		[XuanjiAiSettings.Credentials]: {
			type: 'array',
			default: [],
			description: localize('xuanjiAi.credentials', "Saved credential metadata without secret values"),
			items: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'Credential ID' },
					label: { type: 'string', description: 'Display label' },
					provider: { type: 'string', description: 'Provider name' },
				},
				required: ['id', 'label', 'provider'],
			},
			scope: ConfigurationScope.APPLICATION,
		},
	}
});
