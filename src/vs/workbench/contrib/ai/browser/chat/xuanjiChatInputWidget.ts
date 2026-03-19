/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { IContextAttachment } from '../../../../../platform/ai/common/aiService.js';
import { ICustomModelConfig, XuanjiAiSettings, XuanjiChatMode } from '../../../../../platform/ai/common/aiSettings.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';

interface IChatInputSubmitEvent {
	readonly text: string;
	readonly attachments: IContextAttachment[];
}

interface IFileQuickPickItem extends IQuickPickItem {
	readonly uri: URI;
}

export class XuanjiChatInputWidget extends Disposable {

	private readonly _textarea: HTMLTextAreaElement;
	private readonly _card: HTMLElement;
	private readonly _attachments: IContextAttachment[] = [];
	private readonly _attachmentBar: HTMLElement;
	private readonly _modeLabel: HTMLElement;
	private readonly _modelLabel: HTMLElement;
	private readonly _sendButton: HTMLElement;
	private _modeDropdown: HTMLElement | undefined;
	private _modelDropdown: HTMLElement | undefined;
	private _modelListElement: HTMLElement | undefined;
	private _isPlanReview = false;

	private readonly _onDidSubmit = this._register(new Emitter<IChatInputSubmitEvent>());
	readonly onDidSubmit: Event<IChatInputSubmitEvent> = this._onDidSubmit.event;

	constructor(
		parent: HTMLElement,
		private readonly _quickInputService: IQuickInputService,
		private readonly _workspaceService: IWorkspaceContextService,
		private readonly _fileService: IFileService,
		private readonly _configurationService: IConfigurationService,
		private readonly _commandService: ICommandService,
	) {
		super();

		const container = document.createElement('div');
		container.className = 'xj-input-container';

		this._card = document.createElement('div');
		this._card.className = 'xj-input-card';

		this._attachmentBar = document.createElement('div');
		this._attachmentBar.className = 'xj-attachment-bar';
		this._card.appendChild(this._attachmentBar);

		this._textarea = document.createElement('textarea');
		this._textarea.className = 'xj-input-textarea';
		this._textarea.placeholder = 'Type a message. Press @ to attach files. Press Enter to send.';
		this._textarea.rows = 1;
		this._textarea.addEventListener('keydown', event => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				this._submit();
			}
			if (event.key === '@') {
				void DOM.getWindow(this._textarea).setTimeout(() => {
					void this._showFilePicker();
				}, 0);
			}
		});
		this._textarea.addEventListener('input', () => {
			this._textarea.style.height = 'auto';
			this._textarea.style.height = `${Math.min(this._textarea.scrollHeight, 200)}px`;
		});
		this._card.appendChild(this._textarea);

		const toolbar = document.createElement('div');
		toolbar.className = 'xj-input-toolbar';

		const toolbarLeft = document.createElement('div');
		toolbarLeft.className = 'xj-toolbar-left';

		this._modeLabel = document.createElement('div');
		this._modeLabel.className = 'xj-pill xj-agent-pill';
		this._updateModeLabel();
		this._modeLabel.addEventListener('click', event => {
			event.stopPropagation();
			this._toggleModeDropdown();
		});
		toolbarLeft.appendChild(this._modeLabel);

		this._modelLabel = document.createElement('div');
		this._modelLabel.className = 'xj-pill xj-model-pill';
		this._updateModelLabel();
		this._modelLabel.addEventListener('click', event => {
			event.stopPropagation();
			this._toggleModelDropdown();
		});
		toolbarLeft.appendChild(this._modelLabel);
		toolbar.appendChild(toolbarLeft);

		const toolbarRight = document.createElement('div');
		toolbarRight.className = 'xj-toolbar-right';

		const attachButton = document.createElement('div');
		attachButton.className = 'xj-icon-btn';
		attachButton.title = 'Attach file';
		attachButton.appendChild(this._createIconSpan(Codicon.file));
		attachButton.addEventListener('click', () => {
			void this._showFilePicker();
		});
		toolbarRight.appendChild(attachButton);

		this._sendButton = document.createElement('div');
		this._sendButton.className = 'xj-send-btn';
		this._sendButton.title = 'Send message';
		this._sendButton.appendChild(this._createIconSpan(Codicon.arrowUp));
		this._sendButton.addEventListener('click', () => this._submit());
		toolbarRight.appendChild(this._sendButton);

		toolbar.appendChild(toolbarRight);
		this._card.appendChild(toolbar);

		this._register(DOM.addDisposableListener(DOM.getWindow(this._card).document, 'click', () => this._closeDropdowns()));

		this._register(this._configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(XuanjiAiSettings.ChatMode)) {
				this._updateModeLabel();
				this._updatePlaceholder();
			}
			if (event.affectsConfiguration(XuanjiAiSettings.Model) || event.affectsConfiguration(XuanjiAiSettings.CustomModels)) {
				this._updateModelLabel();
				if (this._modelListElement) {
					this._renderDropdownModels(this._modelListElement, '');
				}
			}
		}));

		this._updatePlaceholder();

		container.appendChild(this._card);
		parent.appendChild(container);
	}

	focus(): void {
		this._textarea.focus();
	}

	setEnabled(enabled: boolean): void {
		this._textarea.disabled = !enabled;
		this._sendButton.classList.toggle('disabled', !enabled);
	}

	setPlanReviewState(enabled: boolean): void {
		this._isPlanReview = enabled;
		this._updatePlaceholder();
	}

	private _createIconSpan(icon: ThemeIcon): HTMLElement {
		const span = document.createElement('span');
		span.className = ThemeIcon.asClassName(icon);
		return span;
	}

	private _createChevron(): HTMLElement {
		const chevron = document.createElement('span');
		chevron.className = `xj-chevron ${ThemeIcon.asClassName(Codicon.chevronDown)}`;
		return chevron;
	}

	private _getModels(): { id: string; name: string; provider: string }[] {
		const models = this._configurationService.getValue<ICustomModelConfig[]>(XuanjiAiSettings.CustomModels) || [];
		return models.map(model => ({
			id: model.id,
			name: model.name,
			provider: model.provider,
		}));
	}

	private _updateModelLabel(): void {
		const modelId = this._configurationService.getValue<string>(XuanjiAiSettings.Model) || '';
		const models = this._getModels();
		const selectedModel = models.find(model => model.id === modelId) || models[0];

		this._modelLabel.textContent = '';
		this._modelLabel.appendChild(document.createTextNode(selectedModel?.name || 'Add model'));
		this._modelLabel.appendChild(this._createChevron());
	}

	private _getChatMode(): XuanjiChatMode {
		const mode = this._configurationService.getValue<string>(XuanjiAiSettings.ChatMode);
		if (mode === 'agent' || mode === 'plan') {
			return mode;
		}
		return 'chat';
	}

	private _updateModeLabel(): void {
		const currentMode = this._getChatMode();
		const label = currentMode === 'agent' ? 'Agent' : currentMode === 'plan' ? 'Plan' : 'Chat';
		const icon = currentMode === 'plan' ? Codicon.listOrdered : currentMode === 'agent' ? Codicon.symbolEvent : Codicon.commentDiscussion;

		this._modeLabel.textContent = '';
		this._modeLabel.appendChild(this._createIconSpan(icon));
		this._modeLabel.appendChild(document.createTextNode(label));
		this._modeLabel.appendChild(this._createChevron());
	}

	private _toggleModeDropdown(): void {
		if (this._modeDropdown) {
			this._closeModeDropdown();
		} else {
			this._openModeDropdown();
		}
	}

	private _toggleModelDropdown(): void {
		if (this._modelDropdown) {
			this._closeModelDropdown();
		} else {
			this._openModelDropdown();
		}
	}

	private _closeModelDropdown(): void {
		this._modelDropdown?.remove();
		this._modelDropdown = undefined;
		this._modelListElement = undefined;
	}

	private _closeModeDropdown(): void {
		this._modeDropdown?.remove();
		this._modeDropdown = undefined;
	}

	private _closeDropdowns(): void {
		this._closeModeDropdown();
		this._closeModelDropdown();
	}

	private _openModeDropdown(): void {
		this._closeDropdowns();

		const dropdown = document.createElement('div');
		dropdown.className = 'xj-model-dropdown xj-mode-dropdown';
		dropdown.addEventListener('click', event => event.stopPropagation());

		const modes: Array<{ mode: XuanjiChatMode; label: string; description: string }> = [
			{ mode: 'chat', label: 'Chat', description: 'Normal conversation without a planning gate.' },
			{ mode: 'agent', label: 'Agent', description: 'Plan internally before using tools.' },
			{ mode: 'plan', label: 'Plan', description: 'Draft a visible plan and wait for approval.' },
		];
		const currentMode = this._getChatMode();

		for (const entry of modes) {
			const item = document.createElement('div');
			item.className = 'xj-dropdown-item';
			if (entry.mode === currentMode) {
				item.classList.add('selected');
			}

			const label = document.createElement('div');
			label.className = 'xj-dropdown-text';
			const title = document.createElement('div');
			title.className = 'xj-dropdown-item-name';
			title.textContent = entry.label;
			label.appendChild(title);

			const description = document.createElement('div');
			description.className = 'xj-dropdown-item-description';
			description.textContent = entry.description;
			label.appendChild(description);
			item.appendChild(label);

			if (entry.mode === currentMode) {
				const check = document.createElement('span');
				check.className = `xj-dropdown-check ${ThemeIcon.asClassName(Codicon.check)}`;
				item.appendChild(check);
			}

			item.addEventListener('click', () => {
				void this._configurationService.updateValue(XuanjiAiSettings.ChatMode, entry.mode);
				this._closeModeDropdown();
			});
			dropdown.appendChild(item);
		}

		this._card.appendChild(dropdown);
		this._modeDropdown = dropdown;
	}

	private _openModelDropdown(): void {
		this._closeDropdowns();

		const dropdown = document.createElement('div');
		dropdown.className = 'xj-model-dropdown';
		dropdown.addEventListener('click', event => event.stopPropagation());

		const models = this._getModels();
		if (models.length > 0) {
			const searchInput = document.createElement('input');
			searchInput.className = 'xj-dropdown-search';
			searchInput.placeholder = 'Search models';
			searchInput.addEventListener('input', () => {
				if (this._modelListElement) {
					this._renderDropdownModels(this._modelListElement, searchInput.value);
				}
			});
			dropdown.appendChild(searchInput);

			this._modelListElement = document.createElement('div');
			this._modelListElement.className = 'xj-dropdown-list';
			dropdown.appendChild(this._modelListElement);
			this._renderDropdownModels(this._modelListElement, '');

			void DOM.getWindow(searchInput).setTimeout(() => searchInput.focus(), 0);
		} else {
			const empty = document.createElement('div');
			empty.className = 'xj-dropdown-empty';
			empty.textContent = 'No models configured';
			dropdown.appendChild(empty);
		}

		const divider = document.createElement('div');
		divider.className = 'xj-dropdown-divider';
		dropdown.appendChild(divider);

		const manageModels = document.createElement('div');
		manageModels.className = 'xj-dropdown-add';
		manageModels.appendChild(document.createTextNode('Manage models'));
		manageModels.appendChild(this._createChevron());
		manageModels.addEventListener('click', () => {
			this._closeModelDropdown();
			void this._commandService.executeCommand('xuanji.ai.openSettings');
		});
		dropdown.appendChild(manageModels);

		this._card.appendChild(dropdown);
		this._modelDropdown = dropdown;
	}

	private _renderDropdownModels(container: HTMLElement, filter: string): void {
		container.textContent = '';
		const currentModel = this._configurationService.getValue<string>(XuanjiAiSettings.Model) || '';
		const lowerFilter = filter.toLowerCase();

		for (const model of this._getModels()) {
			if (lowerFilter && !model.name.toLowerCase().includes(lowerFilter) && !model.id.toLowerCase().includes(lowerFilter)) {
				continue;
			}

			const item = document.createElement('div');
			item.className = 'xj-dropdown-item';
			if (model.id === currentModel) {
				item.classList.add('selected');
			}

			const providerTag = document.createElement('span');
			providerTag.className = 'xj-dropdown-provider-icon';
			providerTag.textContent = this._getProviderMonogram(model.provider);
			item.appendChild(providerTag);

			const name = document.createElement('span');
			name.className = 'xj-dropdown-item-name';
			name.textContent = model.name;
			item.appendChild(name);

			if (model.id === currentModel) {
				const check = document.createElement('span');
				check.className = `xj-dropdown-check ${ThemeIcon.asClassName(Codicon.check)}`;
				item.appendChild(check);
			}

			item.addEventListener('click', () => {
				void this._configurationService.updateValue(XuanjiAiSettings.Model, model.id);
				this._closeModelDropdown();
			});

			container.appendChild(item);
		}
	}

	private _getProviderMonogram(provider: string): string {
		const normalized = provider.toUpperCase().replace(/[^A-Z0-9]/g, '');
		return normalized.slice(0, 2) || 'AI';
	}

	private _updatePlaceholder(): void {
		if (this._isPlanReview) {
			this._textarea.placeholder = 'Review the plan, type feedback to revise it, or use Run Plan.';
			return;
		}

		switch (this._getChatMode()) {
			case 'agent':
				this._textarea.placeholder = 'Describe a task. Agent mode will plan internally before using tools.';
				return;
			case 'plan':
				this._textarea.placeholder = 'Describe a task. Plan mode will draft steps before execution.';
				return;
			default:
				this._textarea.placeholder = 'Type a message. Press @ to attach files. Press Enter to send.';
		}
	}

	private _submit(): void {
		const text = this._textarea.value.trim();
		if (!text) {
			return;
		}

		this._onDidSubmit.fire({
			text,
			attachments: [...this._attachments],
		});

		this._textarea.value = '';
		this._textarea.style.height = 'auto';
		this._attachments.length = 0;
		this._updateAttachmentBar();
	}

	private async _showFilePicker(): Promise<void> {
		const folders = this._workspaceService.getWorkspace().folders;
		if (folders.length === 0) {
			return;
		}

		const result = await this._quickInputService.pick(await this._getFileQuickPicks(folders[0].uri), {
			placeHolder: 'Select a file to attach',
		});

		if (!result) {
			return;
		}

		const content = await this._fileService.readFile(result.uri);
		this._attachments.push({
			type: 'file',
			name: result.label,
			content: content.value.toString(),
		});
		this._updateAttachmentBar();
	}

	private async _getFileQuickPicks(rootUri: URI): Promise<IFileQuickPickItem[]> {
		try {
			const stat = await this._fileService.resolve(rootUri);
			const children: readonly IFileStat[] = stat.children || [];
			return children
				.filter(child => !child.isDirectory)
				.slice(0, 50)
				.map(child => ({
					label: child.name,
					description: child.resource.path,
					uri: child.resource,
				}));
		} catch {
			return [];
		}
	}

	private _updateAttachmentBar(): void {
		this._attachmentBar.textContent = '';
		for (const attachment of this._attachments) {
			const tag = document.createElement('span');
			tag.className = 'xj-attachment-tag';

			const icon = this._createIconSpan(Codicon.file);
			icon.style.marginRight = '4px';
			tag.appendChild(icon);
			tag.appendChild(document.createTextNode(attachment.name));

			const removeButton = document.createElement('span');
			removeButton.className = 'xj-attachment-remove';
			removeButton.textContent = 'Remove';
			removeButton.addEventListener('click', () => {
				const index = this._attachments.indexOf(attachment);
				if (index >= 0) {
					this._attachments.splice(index, 1);
					this._updateAttachmentBar();
				}
			});
			tag.appendChild(removeButton);

			this._attachmentBar.appendChild(tag);
		}
	}
}
