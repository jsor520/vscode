/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { ISecretStorageService } from '../../secrets/common/secrets.js';
import { ILogService } from '../../log/common/log.js';
import { IAICredentialConfig, ICustomModelConfig, XuanjiAiSettings } from './aiSettings.js';

const SECRET_KEY_PREFIX = 'xuanji.ai.credential.';

export const IAICredentialsService = createDecorator<IAICredentialsService>('aiCredentialsService');

export interface IAICredentialsService {
	readonly _serviceBrand: undefined;

	migrateLegacyModelsIfNeeded(): Promise<void>;
	listCredentials(): Promise<IAICredentialConfig[]>;
	getCredential(id: string): Promise<IAICredentialConfig | undefined>;
	getCredentialSecret(id: string): Promise<string | undefined>;
	hasCredentialSecret(id: string): Promise<boolean>;
	saveCredential(metadata: IAICredentialConfig, secret: string): Promise<void>;
	deleteCredential(id: string): Promise<void>;
}

export class AICredentialsService extends Disposable implements IAICredentialsService {
	declare readonly _serviceBrand: undefined;

	private _migrationPromise: Promise<void> | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	async migrateLegacyModelsIfNeeded(): Promise<void> {
		if (!this._migrationPromise) {
			this._migrationPromise = this._doMigration();
		}
		await this._migrationPromise;
	}

	async listCredentials(): Promise<IAICredentialConfig[]> {
		await this.migrateLegacyModelsIfNeeded();
		return this._getCredentialsFromConfig();
	}

	async getCredential(id: string): Promise<IAICredentialConfig | undefined> {
		const credentials = await this.listCredentials();
		return credentials.find(c => c.id === id);
	}

	async getCredentialSecret(id: string): Promise<string | undefined> {
		await this.migrateLegacyModelsIfNeeded();
		return this._secretStorageService.get(this._getSecretKey(id));
	}

	async hasCredentialSecret(id: string): Promise<boolean> {
		const secret = await this.getCredentialSecret(id);
		return !!secret;
	}

	async saveCredential(metadata: IAICredentialConfig, secret: string): Promise<void> {
		await this.migrateLegacyModelsIfNeeded();

		const credentials = this._getCredentialsFromConfig();
		const existingIndex = credentials.findIndex(c => c.id === metadata.id);

		if (existingIndex === -1) {
			credentials.push(metadata);
		} else {
			credentials[existingIndex] = metadata;
		}

		await this._configurationService.updateValue(XuanjiAiSettings.Credentials, credentials);

		const trimmedSecret = secret.trim();
		if (trimmedSecret) {
			await this._secretStorageService.set(this._getSecretKey(metadata.id), trimmedSecret);
		} else {
			await this._secretStorageService.delete(this._getSecretKey(metadata.id));
		}
	}

	async deleteCredential(id: string): Promise<void> {
		await this.migrateLegacyModelsIfNeeded();

		const credentials = this._getCredentialsFromConfig().filter(c => c.id !== id);
		await this._configurationService.updateValue(XuanjiAiSettings.Credentials, credentials);
		await this._secretStorageService.delete(this._getSecretKey(id));
	}

	private async _doMigration(): Promise<void> {
		const models = (this._configurationService.getValue<ICustomModelConfig[]>(XuanjiAiSettings.CustomModels) || []).map(model => ({ ...model }));
		const credentials = [...this._getCredentialsFromConfig()];
		const existingCredentialIds = new Set(credentials.map(c => c.id));

		let modelsChanged = false;
		let credentialsChanged = false;

		for (const model of models) {
			const legacyApiKey = typeof model.apiKey === 'string' ? model.apiKey.trim() : '';
			if (!legacyApiKey) {
				if (model.apiKey !== undefined) {
					delete model.apiKey;
					modelsChanged = true;
				}
				continue;
			}

			let credentialId = model.credentialId?.trim();
			if (!credentialId) {
				credentialId = this._createCredentialId(model.id, existingCredentialIds);
				model.credentialId = credentialId;
				modelsChanged = true;
			}

			if (!credentials.some(c => c.id === credentialId)) {
				credentials.push({
					id: credentialId,
					label: `${model.name} Key`,
					provider: model.provider,
				});
				existingCredentialIds.add(credentialId);
				credentialsChanged = true;
			}

			const existingSecret = await this._secretStorageService.get(this._getSecretKey(credentialId));
			if (!existingSecret) {
				await this._secretStorageService.set(this._getSecretKey(credentialId), legacyApiKey);
			}

			delete model.apiKey;
			modelsChanged = true;
		}

		if (credentialsChanged) {
			this._logService.info('[XuanJi AI] Migrating legacy model secrets to SecretStorage.');
			await this._configurationService.updateValue(XuanjiAiSettings.Credentials, credentials);
		}

		if (modelsChanged) {
			await this._configurationService.updateValue(XuanjiAiSettings.CustomModels, models);
		}
	}

	private _getCredentialsFromConfig(): IAICredentialConfig[] {
		return this._configurationService.getValue<IAICredentialConfig[]>(XuanjiAiSettings.Credentials) || [];
	}

	private _createCredentialId(base: string, existingIds: Set<string>): string {
		const safeBase = base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
		let candidate = `cred-${safeBase}`;
		let counter = 2;
		while (existingIds.has(candidate)) {
			candidate = `cred-${safeBase}-${counter++}`;
		}
		existingIds.add(candidate);
		return candidate;
	}

	private _getSecretKey(id: string): string {
		return `${SECRET_KEY_PREFIX}${id}`;
	}
}
