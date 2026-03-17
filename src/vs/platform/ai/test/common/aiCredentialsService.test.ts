/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { TestSecretStorageService } from '../../../secrets/test/common/testSecretStorageService.js';
import { AICredentialsService } from '../../common/aiCredentialsService.js';
import { IAICredentialConfig, ICustomModelConfig, XuanjiAiSettings } from '../../common/aiSettings.js';

class MutableTestConfigurationService extends TestConfigurationService {
	override updateValue(key: string, value: unknown): Promise<void> {
		return this.setUserConfiguration(key, value);
	}
}

suite('AICredentialsService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('migrates legacy apiKey from model config into SecretStorage', async () => {
		const configService = new MutableTestConfigurationService({
			[XuanjiAiSettings.CustomModels]: <ICustomModelConfig[]>[{
				id: 'claude-sonnet-4-6',
				name: 'Claude Sonnet 4.6',
				provider: 'Anthropic',
				apiFormat: 'anthropic',
				apiBaseUrl: 'https://api.anthropic.com',
				apiKey: 'sk-ant-legacy-1234',
			}],
			[XuanjiAiSettings.Credentials]: <IAICredentialConfig[]>[],
		});
		const secretStorageService = store.add(new TestSecretStorageService());
		const service = store.add(new AICredentialsService(configService, secretStorageService, new NullLogService()));

		await service.migrateLegacyModelsIfNeeded();

		const migratedModels = configService.getValue<ICustomModelConfig[]>(XuanjiAiSettings.CustomModels)!;
		assert.strictEqual(migratedModels.length, 1);
		assert.strictEqual(migratedModels[0].apiKey, undefined);
		assert.strictEqual(migratedModels[0].credentialId, 'cred-claude-sonnet-4-6');

		const credentials = await service.listCredentials();
		assert.deepStrictEqual(credentials, <IAICredentialConfig[]>[{
			id: 'cred-claude-sonnet-4-6',
			label: 'Claude Sonnet 4.6 Key',
			provider: 'Anthropic',
		}]);

		assert.strictEqual(
			await secretStorageService.get('xuanji.ai.credential.cred-claude-sonnet-4-6'),
			'sk-ant-legacy-1234',
		);
	});

	test('saveCredential updates metadata and stores secret separately', async () => {
		const configService = new MutableTestConfigurationService({
			[XuanjiAiSettings.CustomModels]: <ICustomModelConfig[]>[],
			[XuanjiAiSettings.Credentials]: <IAICredentialConfig[]>[],
		});
		const secretStorageService = store.add(new TestSecretStorageService());
		const service = store.add(new AICredentialsService(configService, secretStorageService, new NullLogService()));

		await service.saveCredential({
			id: 'anthropic-main',
			label: 'Anthropic Main',
			provider: 'Anthropic',
		}, 'sk-ant-live-5678');

		assert.deepStrictEqual(await service.listCredentials(), <IAICredentialConfig[]>[{
			id: 'anthropic-main',
			label: 'Anthropic Main',
			provider: 'Anthropic',
		}]);
		assert.strictEqual(await service.getCredentialSecret('anthropic-main'), 'sk-ant-live-5678');
	});
});
