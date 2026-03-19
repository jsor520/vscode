/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IAIService } from '../../../../../platform/ai/common/aiService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { XuanjiChatWidget } from './xuanjiChatWidget.js';
import { XuanjiChatService } from './xuanjiChatService.js';
import { XuanjiRulesEngine } from '../../common/rules/rulesEngine.js';
import { IToolRegistry } from '../../common/toolRegistry.js';
import { XuanjiAgentController } from '../agent/agentController.js';

export const XUANJI_CHAT_VIEW_ID = 'workbench.view.xuanjiChat';
export const XUANJI_CHAT_CONTAINER_ID = 'workbench.panel.xuanjiChat';

export class XuanjiChatViewPane extends ViewPane {

	private _widget: XuanjiChatWidget | undefined;
	private _chatService: XuanjiChatService | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
		@IFileService private readonly _fileService: IFileService,
		@IAIService private readonly _aiService: IAIService,
		@IToolRegistry private readonly _toolRegistry: IToolRegistry,
		@ICommandService private readonly _commandService: ICommandService,
		@ILogService private readonly _logService: ILogService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const rulesEngine = new XuanjiRulesEngine(this._fileService, this._workspaceService, this._logService);
		const agentController = this._register(this.instantiationService.createInstance(XuanjiAgentController));

		this._chatService = this._register(new XuanjiChatService(
			this._aiService,
			this._toolRegistry,
			this.configurationService,
			rulesEngine,
			agentController,
		));

		this._widget = this._register(new XuanjiChatWidget(
			container,
			this._chatService,
			this.openerService,
			this._quickInputService,
			this._workspaceService,
			this._fileService,
			this.configurationService,
			this._commandService,
		));
	}

	override focus(): void {
		super.focus();
		this._widget?.focus();
	}

	clearChat(): void {
		this._chatService?.clearHistory();
		this._widget?.clearMessages();
	}

	stopGeneration(): void {
		this._chatService?.stopGeneration();
	}
}
