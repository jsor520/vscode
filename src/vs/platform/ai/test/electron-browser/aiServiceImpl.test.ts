/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../log/common/log.js';
import { IAICredentialsService } from '../../common/aiCredentialsService.js';
import { ICompletionContext } from '../../common/aiService.js';
import { ICustomModelConfig, XuanjiAiSettings } from '../../common/aiSettings.js';
import { ElectronAIServiceImpl } from '../../electron-browser/aiServiceImpl.js';

class MutableTestConfigurationService extends TestConfigurationService {
	override updateValue(key: string, value: unknown): Promise<void> {
		return this.setUserConfiguration(key, value);
	}
}

class StubAICredentialsService implements IAICredentialsService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly secrets: Record<string, string | undefined>) { }

	async migrateLegacyModelsIfNeeded(): Promise<void> { }
	async listCredentials() { return []; }
	async getCredential() { return undefined; }
	async getCredentialSecret(id: string): Promise<string | undefined> { return this.secrets[id]; }
	async hasCredentialSecret(id: string): Promise<boolean> { return !!this.secrets[id]; }
	async saveCredential(): Promise<void> { }
	async deleteCredential(): Promise<void> { }
}

suite('ElectronAIServiceImpl', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const completionContext: ICompletionContext = {
		fileUri: 'file:///test.ts',
		position: { line: 1, column: 1 },
		prefix: 'const x = ',
		suffix: '',
		language: 'typescript',
	};

	test('uses Authorization header from credential for openai-compatible models', async () => {
		const configService = new MutableTestConfigurationService({
			[XuanjiAiSettings.Model]: 'gpt-4o',
			[XuanjiAiSettings.CustomModels]: <ICustomModelConfig[]>[{
				id: 'gpt-4o',
				name: 'GPT-4o',
				provider: 'OpenAI',
				apiFormat: 'openai',
				apiBaseUrl: 'https://api.openai.com',
				credentialId: 'openai-main',
			}],
		});
		const credentialsService = new StubAICredentialsService({ 'openai-main': 'sk-openai-test-1234' });
		const service = store.add(new ElectronAIServiceImpl(configService, credentialsService, new NullLogService()));

		const originalFetch = globalThis.fetch;
		let capturedAuthorization: string | undefined;
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			capturedAuthorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
			return {
				ok: true,
				text: async () => JSON.stringify({
					choices: [{ message: { content: 'console.log("hi")' } }],
				}),
			} as Response;
		}) as typeof fetch;

		try {
			const result = await service.complete(completionContext);
			assert.strictEqual(capturedAuthorization, 'Bearer sk-openai-test-1234');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].text, 'console.log("hi")');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('uses x-api-key header from credential for anthropic models', async () => {
		const configService = new MutableTestConfigurationService({
			[XuanjiAiSettings.Model]: 'claude-sonnet-4-6',
			[XuanjiAiSettings.CustomModels]: <ICustomModelConfig[]>[{
				id: 'claude-sonnet-4-6',
				name: 'Claude Sonnet 4.6',
				provider: 'Anthropic',
				apiFormat: 'anthropic',
				apiBaseUrl: 'https://api.anthropic.com',
				credentialId: 'anthropic-main',
			}],
		});
		const credentialsService = new StubAICredentialsService({ 'anthropic-main': 'sk-ant-test-5678' });
		const service = store.add(new ElectronAIServiceImpl(configService, credentialsService, new NullLogService()));

		const originalFetch = globalThis.fetch;
		let capturedApiKey: string | undefined;
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			capturedApiKey = (init?.headers as Record<string, string> | undefined)?.['x-api-key'];
			return {
				ok: true,
				text: async () => JSON.stringify({
					content: [{ type: 'text', text: 'function migrated() {}' }],
				}),
			} as Response;
		}) as typeof fetch;

		try {
			const result = await service.complete(completionContext);
			assert.strictEqual(capturedApiKey, 'sk-ant-test-5678');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].text, 'function migrated() {}');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});