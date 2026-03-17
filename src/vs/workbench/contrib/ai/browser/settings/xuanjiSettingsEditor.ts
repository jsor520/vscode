/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ApiFormat, API_FORMAT_OPTIONS, IAICredentialConfig, ICustomModelConfig, XuanjiAiSettings } from '../../../../../platform/ai/common/aiSettings.js';
import { IAICredentialsService } from '../../../../../platform/ai/common/aiCredentialsService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { XuanjiSettingsInput } from './xuanjiSettingsInput.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';

export class XuanjiSettingsEditor extends EditorPane {

	static readonly ID = 'workbench.editor.xuanjiSettings';

	private _container!: HTMLElement;
	private _navItems = new Map<string, HTMLElement>();
	private _sections = new Map<string, HTMLElement>();
	private _modelListEl?: HTMLElement;
	private _credentialListEl?: HTMLElement;
	private _defaultModelSelect?: HTMLSelectElement;
	private _addModelDialog?: HTMLElement;
	private _addCredentialDialog?: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAICredentialsService private readonly _credentialsService: IAICredentialsService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super(XuanjiSettingsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = document.createElement('div');
		this._container.className = 'xuanji-settings-container';
		parent.appendChild(this._container);

		const sidebar = document.createElement('div');
		sidebar.className = 'xuanji-settings-sidebar';
		const header = document.createElement('div');
		header.className = 'xuanji-settings-sidebar-header';
		header.textContent = 'XuanJi Settings';
		sidebar.appendChild(header);

		this._createNavItem(sidebar, 'models', Codicon.symbolClass, localize('xuanjiSettings.models', "Models"));
		this._createNavItem(sidebar, 'credentials', Codicon.lock, localize('xuanjiSettings.credentials', "Credentials"));
		this._createNavItem(sidebar, 'general', Codicon.gear, localize('xuanjiSettings.general', "General"));
		this._container.appendChild(sidebar);

		const content = document.createElement('div');
		content.className = 'xuanji-settings-content';
		this._createModelsSection(content);
		this._createCredentialsSection(content);
		this._createGeneralSection(content);
		this._container.appendChild(content);
		this._switchSection('models');

		void this._initializeAsync();
	}

	private async _initializeAsync(): Promise<void> {
		await this._credentialsService.migrateLegacyModelsIfNeeded();
		await this._refreshAllAsync();
	}

	private _createNavItem(sidebar: HTMLElement, id: string, icon: ThemeIcon, label: string): void {
		const item = document.createElement('div');
		item.className = 'xuanji-settings-nav-item';
		item.dataset.section = id;

		const iconEl = document.createElement('span');
		iconEl.className = `xuanji-settings-nav-icon ${ThemeIcon.asClassName(icon)}`;
		item.appendChild(iconEl);

		const labelEl = document.createElement('span');
		labelEl.textContent = label;
		item.appendChild(labelEl);

		item.addEventListener('click', () => this._switchSection(id));
		sidebar.appendChild(item);
		this._navItems.set(id, item);
	}

	private _switchSection(id: string): void {
		for (const [navId, el] of this._navItems) {
			el.classList.toggle('active', navId === id);
		}
		for (const [secId, el] of this._sections) {
			el.classList.toggle('active', secId === id);
		}
	}

	private _getCustomModels(): ICustomModelConfig[] {
		return this._configurationService.getValue<ICustomModelConfig[]>(XuanjiAiSettings.CustomModels) || [];
	}

	private async _getCredentialMap(): Promise<Map<string, IAICredentialConfig>> {
		const credentials = await this._credentialsService.listCredentials();
		return new Map(credentials.map(credential => [credential.id, credential]));
	}

	private async _refreshAllAsync(): Promise<void> {
		await this._renderModelList();
		await this._renderCredentialList();
		if (this._defaultModelSelect) {
			this._populateModelSelect(this._defaultModelSelect);
		}
	}

	private _createModelsSection(parent: HTMLElement): void {
		const section = document.createElement('div');
		section.className = 'xuanji-settings-section';
		this._sections.set('models', section);

		const title = document.createElement('h2');
		title.textContent = localize('xuanjiSettings.modelsTitle', "Models");
		section.appendChild(title);

		const description = document.createElement('div');
		description.className = 'xuanji-settings-field-description';
		description.textContent = localize('xuanjiSettings.modelsDesc', "Model settings and secrets are stored separately. One credential can be reused by multiple models.");
		section.appendChild(description);

		this._modelListEl = document.createElement('div');
		this._modelListEl.className = 'xuanji-settings-model-list';
		section.appendChild(this._modelListEl);

		const addBtn = document.createElement('button');
		addBtn.className = 'xuanji-settings-btn';
		addBtn.style.marginTop = '16px';
		addBtn.textContent = '+ ' + localize('xuanjiSettings.addModel', "Add Model");
		addBtn.addEventListener('click', () => { void this._showAddModelDialog(); });
		section.appendChild(addBtn);

		this._addModelDialog = document.createElement('div');
		this._addModelDialog.className = 'xuanji-settings-add-model-dialog';
		this._addModelDialog.style.display = 'none';
		section.appendChild(this._addModelDialog);

		const defaultModel = document.createElement('div');
		defaultModel.className = 'xuanji-settings-default-model';
		const selectLabel = document.createElement('label');
		selectLabel.textContent = localize('xuanjiSettings.defaultModel', "Default Model");
		defaultModel.appendChild(selectLabel);

		const desc = document.createElement('div');
		desc.className = 'xuanji-settings-field-description';
		desc.textContent = localize('xuanjiSettings.defaultModelDesc', "Choose the default AI model used by chat and other AI features.");
		defaultModel.appendChild(desc);

		this._defaultModelSelect = document.createElement('select');
		this._defaultModelSelect.className = 'xuanji-settings-select';
		this._populateModelSelect(this._defaultModelSelect);
		this._defaultModelSelect.addEventListener('change', () => {
			void this._configurationService.updateValue(XuanjiAiSettings.Model, this._defaultModelSelect!.value);
			void this._renderModelList();
		});
		defaultModel.appendChild(this._defaultModelSelect);
		section.appendChild(defaultModel);
		parent.appendChild(section);
	}

	private _populateModelSelect(select: HTMLSelectElement): void {
		const currentModel = this._configurationService.getValue<string>(XuanjiAiSettings.Model) || '';
		const models = this._getCustomModels();
		select.textContent = '';

		if (models.length === 0) {
			const option = document.createElement('option');
			option.value = '';
			option.textContent = 'Add a model first';
			option.disabled = true;
			option.selected = true;
			select.appendChild(option);
			return;
		}

		for (const model of models) {
			const option = document.createElement('option');
			option.value = model.id;
			option.textContent = `${model.name} (${model.provider})`;
			if (model.id === currentModel) {
				option.selected = true;
			}
			select.appendChild(option);
		}
	}

	private async _renderModelList(): Promise<void> {
		if (!this._modelListEl) {
			return;
		}

		this._modelListEl.textContent = '';
		const currentModel = this._configurationService.getValue<string>(XuanjiAiSettings.Model) || '';
		const models = this._getCustomModels();
		const credentialMap = await this._getCredentialMap();

		if (models.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'xuanji-settings-empty';
			empty.textContent = 'No models yet. Add your first model below.';
			this._modelListEl.appendChild(empty);
			return;
		}

		for (const model of models) {
			const item = document.createElement('div');
			item.className = 'xuanji-settings-model-item';
			const nameContainer = document.createElement('div');
			nameContainer.style.flex = '1';
			nameContainer.style.minWidth = '0';

			const topRow = document.createElement('div');
			topRow.style.display = 'flex';
			topRow.style.alignItems = 'center';
			topRow.style.gap = '8px';
			const name = document.createElement('span');
			name.className = 'xuanji-settings-model-name';
			name.textContent = model.name;
			topRow.appendChild(name);

			const providerLabel = document.createElement('span');
			providerLabel.className = 'xuanji-settings-model-id';
			providerLabel.textContent = model.provider;
			topRow.appendChild(providerLabel);

			const idLabel = document.createElement('span');
			idLabel.className = 'xuanji-settings-model-id';
			idLabel.textContent = `ID: ${model.id}`;
			topRow.appendChild(idLabel);
			nameContainer.appendChild(topRow);

			const bottomRow = document.createElement('div');
			bottomRow.style.display = 'flex';
			bottomRow.style.alignItems = 'center';
			bottomRow.style.gap = '8px';
			bottomRow.style.marginTop = '2px';
			bottomRow.style.flexWrap = 'wrap';
			const formatLabel = document.createElement('span');
			formatLabel.className = 'xuanji-settings-model-meta';
			const formatOption = API_FORMAT_OPTIONS.find(f => f.value === model.apiFormat);
			formatLabel.textContent = formatOption ? formatOption.label : model.apiFormat;
			bottomRow.appendChild(formatLabel);

			const baseUrlLabel = document.createElement('span');
			baseUrlLabel.className = 'xuanji-settings-model-meta';
			baseUrlLabel.textContent = model.apiBaseUrl;
			bottomRow.appendChild(baseUrlLabel);

			const credential = model.credentialId ? credentialMap.get(model.credentialId) : undefined;
			const credentialLabel = document.createElement('span');
			credentialLabel.className = 'xuanji-settings-model-meta';
			credentialLabel.textContent = credential ? `Credential: ${credential.label}` : model.credentialId ? `Credential: ${model.credentialId}` : 'Credential: None';
			bottomRow.appendChild(credentialLabel);
			nameContainer.appendChild(bottomRow);
			item.appendChild(nameContainer);

			const actions = document.createElement('div');
			actions.style.display = 'flex';
			actions.style.alignItems = 'center';
			actions.style.gap = '8px';
			const removeBtn = document.createElement('span');
			removeBtn.className = 'xuanji-settings-model-remove';
			removeBtn.textContent = 'Remove';
			removeBtn.title = localize('xuanjiSettings.removeModel', "Remove model");
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this._removeModel(model.id);
			});
			actions.appendChild(removeBtn);

			const toggle = document.createElement('div');
			toggle.className = 'xuanji-settings-toggle';
			if (model.id === currentModel) {
				toggle.classList.add('on');
			}
			toggle.addEventListener('click', () => {
				if (!toggle.classList.contains('on')) {
					void this._configurationService.updateValue(XuanjiAiSettings.Model, model.id);
					void this._refreshAllAsync();
				}
			});
			actions.appendChild(toggle);
			item.appendChild(actions);
			this._modelListEl.appendChild(item);
		}
	}

	private async _showAddModelDialog(): Promise<void> {
		const dialog = this._addModelDialog;
		if (!dialog) {
			return;
		}

		dialog.style.display = 'block';
		dialog.textContent = '';

		const h3 = document.createElement('h3');
		h3.textContent = localize('xuanjiSettings.addModelTitle', "Add Model");
		h3.style.borderTop = 'none';
		h3.style.paddingTop = '0';
		dialog.appendChild(h3);

		const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

		this._addDialogField(dialog, inputs, { key: 'provider', label: 'Provider', placeholder: 'e.g. Anthropic, OpenAI, Google, DeepSeek...', type: 'text' });
		this._addDialogField(dialog, inputs, { key: 'id', label: 'Model ID', placeholder: 'e.g. claude-sonnet-4-6-20250514, gpt-4o...', type: 'text' });
		this._addDialogField(dialog, inputs, { key: 'name', label: 'Display Name', placeholder: 'e.g. Sonnet 4.6, GPT-4o', type: 'text' });

		const formatField = document.createElement('div');
		formatField.className = 'xuanji-settings-field';
		formatField.style.marginBottom = '12px';
		const formatLabel = document.createElement('label');
		formatLabel.textContent = 'API Format';
		formatField.appendChild(formatLabel);

		const formatSelect = document.createElement('select');
		formatSelect.className = 'xuanji-settings-select';
		for (const opt of API_FORMAT_OPTIONS) {
			const option = document.createElement('option');
			option.value = opt.value;
			option.textContent = opt.label;
			formatSelect.appendChild(option);
		}
		formatField.appendChild(formatSelect);
		inputs.set('apiFormat', formatSelect);
		dialog.appendChild(formatField);

		this._addDialogField(dialog, inputs, { key: 'apiBaseUrl', label: 'API Base URL', placeholder: 'e.g. https://api.anthropic.com, https://api.openai.com', type: 'text' });

		const credentialField = document.createElement('div');
		credentialField.className = 'xuanji-settings-field';
		credentialField.style.marginBottom = '12px';
		const credentialLabel = document.createElement('label');
		credentialLabel.textContent = 'Credential';
		credentialField.appendChild(credentialLabel);

		const credentialDesc = document.createElement('div');
		credentialDesc.className = 'xuanji-settings-field-description';
		credentialDesc.textContent = 'Optional. Link a saved API key to this model. Models without secrets can be left empty.';
		credentialField.appendChild(credentialDesc);

		const credentialSelect = document.createElement('select');
		credentialSelect.className = 'xuanji-settings-select';
		const emptyOption = document.createElement('option');
		emptyOption.value = '';
		emptyOption.textContent = 'No credential';
		credentialSelect.appendChild(emptyOption);

		for (const credential of await this._credentialsService.listCredentials()) {
			const option = document.createElement('option');
			option.value = credential.id;
			option.textContent = `${credential.label} (${credential.provider})`;
			credentialSelect.appendChild(option);
		}

		credentialField.appendChild(credentialSelect);
		inputs.set('credentialId', credentialSelect);
		dialog.appendChild(credentialField);

		const btnRow = document.createElement('div');
		btnRow.style.display = 'flex';
		btnRow.style.gap = '8px';

		const saveBtn = document.createElement('button');
		saveBtn.className = 'xuanji-settings-btn';
		saveBtn.textContent = localize('xuanjiSettings.add', "Add");
		saveBtn.addEventListener('click', () => {
			void (async () => {
				const id = (inputs.get('id') as HTMLInputElement).value.trim();
				const name = (inputs.get('name') as HTMLInputElement).value.trim();
				const provider = (inputs.get('provider') as HTMLInputElement).value.trim();
				const apiFormat = (inputs.get('apiFormat') as HTMLSelectElement).value as ApiFormat;
				const apiBaseUrl = (inputs.get('apiBaseUrl') as HTMLInputElement).value.trim();
				const credentialId = (inputs.get('credentialId') as HTMLSelectElement).value.trim() || undefined;

				if (!id || !name || !provider || !apiBaseUrl) {
					this._notificationService.warn(localize('xuanjiSettings.fillRequiredModel', "Fill in all required fields (Provider, Model ID, Display Name, API Base URL)."));
					return;
				}

				const existing = this._getCustomModels();
				if (existing.some(m => m.id === id)) {
					this._notificationService.warn(localize('xuanjiSettings.modelExists', "Model ID '{0}' already exists", id));
					return;
				}

				const newModel: ICustomModelConfig = { id, name, provider, apiFormat, apiBaseUrl, credentialId };
				const updated = [...existing, newModel];
				await this._configurationService.updateValue(XuanjiAiSettings.CustomModels, updated);

				if (updated.length === 1) {
					await this._configurationService.updateValue(XuanjiAiSettings.Model, id);
				}

				dialog.style.display = 'none';
				await this._refreshAllAsync();
			})();
		});

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'xuanji-settings-btn';
		cancelBtn.style.background = 'var(--vscode-button-secondaryBackground)';
		cancelBtn.style.color = 'var(--vscode-button-secondaryForeground)';
		cancelBtn.textContent = localize('xuanjiSettings.cancel', "Cancel");
		cancelBtn.addEventListener('click', () => {
			dialog.style.display = 'none';
		});

		btnRow.appendChild(saveBtn);
		btnRow.appendChild(cancelBtn);
		dialog.appendChild(btnRow);

		(inputs.get('provider') as HTMLInputElement).focus();
	}

	private async _removeModel(modelId: string): Promise<void> {
		const existing = this._getCustomModels();
		const updated = existing.filter(m => m.id !== modelId);
		await this._configurationService.updateValue(XuanjiAiSettings.CustomModels, updated);

		const currentModel = this._configurationService.getValue<string>(XuanjiAiSettings.Model);
		if (currentModel === modelId) {
			await this._configurationService.updateValue(XuanjiAiSettings.Model, updated.length > 0 ? updated[0].id : '');
		}

		await this._refreshAllAsync();
	}

	private _createCredentialsSection(parent: HTMLElement): void {
		const section = document.createElement('div');
		section.className = 'xuanji-settings-section';
		this._sections.set('credentials', section);

		const title = document.createElement('h2');
		title.textContent = localize('xuanjiSettings.credentialsTitle', "Credentials");
		section.appendChild(title);

		const description = document.createElement('div');
		description.className = 'xuanji-settings-field-description';
		description.textContent = localize('xuanjiSettings.credentialsDesc', "Only credential metadata is stored in settings. Secret values live in secure storage.");
		section.appendChild(description);

		this._credentialListEl = document.createElement('div');
		this._credentialListEl.className = 'xuanji-settings-model-list';
		section.appendChild(this._credentialListEl);

		const addBtn = document.createElement('button');
		addBtn.className = 'xuanji-settings-btn';
		addBtn.style.marginTop = '16px';
		addBtn.textContent = '+ ' + localize('xuanjiSettings.addCredential', "Add Credential");
		addBtn.addEventListener('click', () => { void this._showAddCredentialDialog(); });
		section.appendChild(addBtn);

		this._addCredentialDialog = document.createElement('div');
		this._addCredentialDialog.className = 'xuanji-settings-add-model-dialog';
		this._addCredentialDialog.style.display = 'none';
		section.appendChild(this._addCredentialDialog);

		parent.appendChild(section);
	}

	private async _renderCredentialList(): Promise<void> {
		if (!this._credentialListEl) {
			return;
		}

		this._credentialListEl.textContent = '';
		const credentials = await this._credentialsService.listCredentials();

		if (credentials.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'xuanji-settings-empty';
			empty.textContent = 'No credentials yet. Add one to reuse it across multiple models.';
			this._credentialListEl.appendChild(empty);
			return;
		}

		const statuses = await Promise.all(credentials.map(async credential => ({
			id: credential.id,
			hasSecret: await this._credentialsService.hasCredentialSecret(credential.id),
		})));
		const statusMap = new Map(statuses.map(status => [status.id, status.hasSecret]));

		for (const credential of credentials) {
			const item = document.createElement('div');
			item.className = 'xuanji-settings-model-item';
			const nameContainer = document.createElement('div');
			nameContainer.style.flex = '1';
			nameContainer.style.minWidth = '0';

			const topRow = document.createElement('div');
			topRow.style.display = 'flex';
			topRow.style.alignItems = 'center';
			topRow.style.gap = '8px';
			const name = document.createElement('span');
			name.className = 'xuanji-settings-model-name';
			name.textContent = credential.label;
			topRow.appendChild(name);

			const providerLabel = document.createElement('span');
			providerLabel.className = 'xuanji-settings-model-id';
			providerLabel.textContent = credential.provider;
			topRow.appendChild(providerLabel);

			const idLabel = document.createElement('span');
			idLabel.className = 'xuanji-settings-model-id';
			idLabel.textContent = `ID: ${credential.id}`;
			topRow.appendChild(idLabel);
			nameContainer.appendChild(topRow);

			const bottomRow = document.createElement('div');
			bottomRow.style.display = 'flex';
			bottomRow.style.alignItems = 'center';
			bottomRow.style.gap = '8px';
			bottomRow.style.marginTop = '2px';
			const statusLabel = document.createElement('span');
			statusLabel.className = 'xuanji-settings-model-meta';
			statusLabel.textContent = statusMap.get(credential.id) ? 'Secret: Configured' : 'Secret: Missing';
			bottomRow.appendChild(statusLabel);
			nameContainer.appendChild(bottomRow);
			item.appendChild(nameContainer);

			const actions = document.createElement('div');
			actions.style.display = 'flex';
			actions.style.alignItems = 'center';
			actions.style.gap = '8px';
			const removeBtn = document.createElement('span');
			removeBtn.className = 'xuanji-settings-model-remove';
			removeBtn.textContent = 'Remove';
			removeBtn.title = localize('xuanjiSettings.removeCredential', "Remove credential");
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this._removeCredential(credential.id);
			});
			actions.appendChild(removeBtn);
			item.appendChild(actions);
			this._credentialListEl.appendChild(item);
		}
	}

	private async _showAddCredentialDialog(): Promise<void> {
		const dialog = this._addCredentialDialog;
		if (!dialog) {
			return;
		}

		dialog.style.display = 'block';
		dialog.textContent = '';

		const h3 = document.createElement('h3');
		h3.textContent = localize('xuanjiSettings.addCredentialTitle', "Add Credential");
		h3.style.borderTop = 'none';
		h3.style.paddingTop = '0';
		dialog.appendChild(h3);

		const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
		this._addDialogField(dialog, inputs, { key: 'provider', label: 'Provider', placeholder: 'e.g. Anthropic, OpenAI, OpenRouter...', type: 'text' });
		this._addDialogField(dialog, inputs, { key: 'id', label: 'Credential ID', placeholder: 'e.g. anthropic-main, openrouter-work', type: 'text' });
		this._addDialogField(dialog, inputs, { key: 'label', label: 'Display Label', placeholder: 'e.g. Anthropic Main, OpenRouter Work', type: 'text' });
		this._addDialogField(dialog, inputs, { key: 'secret', label: 'API Key', placeholder: 'e.g. sk-ant-..., sk-...', type: 'password' });

		const btnRow = document.createElement('div');
		btnRow.style.display = 'flex';
		btnRow.style.gap = '8px';

		const saveBtn = document.createElement('button');
		saveBtn.className = 'xuanji-settings-btn';
		saveBtn.textContent = localize('xuanjiSettings.add', "Add");
		saveBtn.addEventListener('click', () => {
			void (async () => {
				const id = (inputs.get('id') as HTMLInputElement).value.trim();
				const label = (inputs.get('label') as HTMLInputElement).value.trim();
				const provider = (inputs.get('provider') as HTMLInputElement).value.trim();
				const secret = (inputs.get('secret') as HTMLInputElement).value.trim();

				if (!id || !label || !provider || !secret) {
					this._notificationService.warn(localize('xuanjiSettings.fillRequiredCredential', "Fill in all credential fields (Provider, Credential ID, Display Label, API Key)."));
					return;
				}

				const existing = await this._credentialsService.listCredentials();
				if (existing.some(c => c.id === id)) {
					this._notificationService.warn(localize('xuanjiSettings.credentialExists', "Credential ID '{0}' already exists", id));
					return;
				}

				await this._credentialsService.saveCredential({ id, label, provider }, secret);
				dialog.style.display = 'none';
				await this._refreshAllAsync();
			})();
		});

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'xuanji-settings-btn';
		cancelBtn.style.background = 'var(--vscode-button-secondaryBackground)';
		cancelBtn.style.color = 'var(--vscode-button-secondaryForeground)';
		cancelBtn.textContent = localize('xuanjiSettings.cancel', "Cancel");
		cancelBtn.addEventListener('click', () => {
			dialog.style.display = 'none';
		});

		btnRow.appendChild(saveBtn);
		btnRow.appendChild(cancelBtn);
		dialog.appendChild(btnRow);

		(inputs.get('provider') as HTMLInputElement).focus();
	}

	private async _removeCredential(credentialId: string): Promise<void> {
		const modelsUsingCredential = this._getCustomModels().filter(model => model.credentialId === credentialId);
		if (modelsUsingCredential.length > 0) {
			this._notificationService.warn(localize(
				'xuanjiSettings.credentialInUse',
				"This credential is still referenced by {0} model(s). Remove those references before deleting it.",
				modelsUsingCredential.length,
			));
			return;
		}

		await this._credentialsService.deleteCredential(credentialId);
		await this._refreshAllAsync();
	}

	private _addDialogField(
		dialog: HTMLElement,
		inputs: Map<string, HTMLInputElement | HTMLSelectElement>,
		options: { key: string; label: string; placeholder: string; type: string },
	): void {
		const field = document.createElement('div');
		field.className = 'xuanji-settings-field';
		field.style.marginBottom = '12px';

		const label = document.createElement('label');
		label.textContent = options.label;
		field.appendChild(label);

		const input = document.createElement('input');
		input.className = 'xuanji-settings-input';
		input.type = options.type;
		input.placeholder = options.placeholder;
		field.appendChild(input);

		inputs.set(options.key, input);
		dialog.appendChild(field);
	}

	private _createGeneralSection(parent: HTMLElement): void {
		const section = document.createElement('div');
		section.className = 'xuanji-settings-section';
		this._sections.set('general', section);

		const title = document.createElement('h2');
		title.textContent = localize('xuanjiSettings.generalTitle', "General");
		section.appendChild(title);

		this._createToggleField(section, {
			label: localize('xuanjiSettings.stripHeaders', "Strip Browser Headers"),
			description: localize('xuanjiSettings.stripHeadersDesc', "Remove browser headers from AI API requests. Keep this enabled if your reverse proxy rejects browser-originated requests."),
			settingKey: XuanjiAiSettings.StripBrowserHeaders,
			defaultValue: true,
		});

		const maxTokensField = document.createElement('div');
		maxTokensField.className = 'xuanji-settings-field';
		const mtLabel = document.createElement('label');
		mtLabel.textContent = localize('xuanjiSettings.maxTokens', "Max Tokens");
		maxTokensField.appendChild(mtLabel);

		const mtDesc = document.createElement('div');
		mtDesc.className = 'xuanji-settings-field-description';
		mtDesc.textContent = localize('xuanjiSettings.maxTokensDesc', "Maximum token count for AI responses (256 - 32768)");
		maxTokensField.appendChild(mtDesc);

		const mtInput = document.createElement('input');
		mtInput.className = 'xuanji-settings-number-input';
		mtInput.type = 'number';
		mtInput.min = '256';
		mtInput.max = '32768';
		mtInput.value = String(this._configurationService.getValue<number>(XuanjiAiSettings.MaxTokens) || 4096);
		mtInput.addEventListener('change', () => {
			const val = parseInt(mtInput.value, 10);
			if (val >= 256 && val <= 32768) {
				void this._configurationService.updateValue(XuanjiAiSettings.MaxTokens, val);
			}
		});
		maxTokensField.appendChild(mtInput);
		section.appendChild(maxTokensField);

		this._createToggleField(section, {
			label: localize('xuanjiSettings.codeCompletion', "Code Completion"),
			description: localize('xuanjiSettings.codeCompletionDesc', "Enable AI code completion"),
			settingKey: XuanjiAiSettings.CompletionEnabled,
			defaultValue: true,
		});

		const debounceField = document.createElement('div');
		debounceField.className = 'xuanji-settings-field';
		const dbLabel = document.createElement('label');
		dbLabel.textContent = localize('xuanjiSettings.debounce', "Completion Debounce (ms)");
		debounceField.appendChild(dbLabel);

		const dbDesc = document.createElement('div');
		dbDesc.className = 'xuanji-settings-field-description';
		dbDesc.textContent = localize('xuanjiSettings.debounceDesc', "Delay before code completion is triggered (100 - 3000 ms)");
		debounceField.appendChild(dbDesc);

		const dbInput = document.createElement('input');
		dbInput.className = 'xuanji-settings-number-input';
		dbInput.type = 'number';
		dbInput.min = '100';
		dbInput.max = '3000';
		dbInput.value = String(this._configurationService.getValue<number>(XuanjiAiSettings.CompletionDebounceMs) || 500);
		dbInput.addEventListener('change', () => {
			const val = parseInt(dbInput.value, 10);
			if (val >= 100 && val <= 3000) {
				void this._configurationService.updateValue(XuanjiAiSettings.CompletionDebounceMs, val);
			}
		});
		debounceField.appendChild(dbInput);
		section.appendChild(debounceField);
		parent.appendChild(section);
	}

	private _createToggleField(parent: HTMLElement, options: { label: string; description: string; settingKey: string; defaultValue: boolean }): void {
		const field = document.createElement('div');
		field.className = 'xuanji-settings-field';

		const label = document.createElement('label');
		label.textContent = options.label;
		field.appendChild(label);

		const desc = document.createElement('div');
		desc.className = 'xuanji-settings-field-description';
		desc.textContent = options.description;
		field.appendChild(desc);

		const toggle = document.createElement('div');
		toggle.className = 'xuanji-settings-toggle';
		const value = this._configurationService.getValue<boolean>(options.settingKey);
		if (value !== false && options.defaultValue || value === true) {
			toggle.classList.add('on');
		}

		toggle.addEventListener('click', () => {
			const newValue = !toggle.classList.contains('on');
			toggle.classList.toggle('on', newValue);
			void this._configurationService.updateValue(options.settingKey, newValue);
		});

		field.appendChild(toggle);
		parent.appendChild(field);
	}

	override async setInput(
		input: XuanjiSettingsInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
	}

	override focus(): void {
		super.focus();
	}

	override layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.width = `${dimension.width}px`;
			this._container.style.height = `${dimension.height}px`;
		}
	}
}
