/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { registerAction2, Action2, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { IAIService, IChatOptions } from '../../../../../platform/ai/common/aiService.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ViewPaneContainer } from '../../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainerLocation, Extensions as ViewExtensions } from '../../../../common/views.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { XuanjiChatViewPane, XUANJI_CHAT_CONTAINER_ID, XUANJI_CHAT_VIEW_ID } from './xuanjiChatViewPane.js';

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const xuanjiChatIcon = registerIcon('xuanji-chat-icon', Codicon.hubot, localize('xuanjiChatIcon', "Icon for the XuanJi AI chat view."));

const xuanjiChatViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: XUANJI_CHAT_CONTAINER_ID,
	title: localize2('xuanjiChat.viewContainer', "XuanJi AI"),
	icon: xuanjiChatIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [XUANJI_CHAT_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: XUANJI_CHAT_CONTAINER_ID,
	hideIfEmpty: false,
	order: 100,
}, ViewContainerLocation.AuxiliaryBar);

const xuanjiChatViewDescriptor: IViewDescriptor = {
	id: XUANJI_CHAT_VIEW_ID,
	containerIcon: xuanjiChatViewContainer.icon,
	containerTitle: xuanjiChatViewContainer.title.value,
	singleViewPaneContainerTitle: xuanjiChatViewContainer.title.value,
	name: localize2('xuanjiChat.view', "XuanJi AI Chat"),
	canToggleVisibility: false,
	canMoveView: true,
	ctorDescriptor: new SyncDescriptor(XuanjiChatViewPane),
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([xuanjiChatViewDescriptor], xuanjiChatViewContainer);

MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
	command: {
		id: 'xuanji.ai.openSettings',
		title: localize2('xuanjiAi.openSettingsTitle', "Open AI Settings"),
		icon: Codicon.gear,
	},
	group: 'navigation',
	when: ContextKeyExpr.equals('view', XUANJI_CHAT_VIEW_ID),
	order: 100,
});

registerAction2(class FocusXuanjiChatAction extends Action2 {
	constructor() {
		super({
			id: 'xuanji.ai.focusChat',
			title: localize2('xuanjiAi.focusChat', "XuanJi: Focus AI Chat"),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		await viewsService.openView(XUANJI_CHAT_VIEW_ID, true);
	}
});

registerAction2(class TestXuanjiConnectionAction extends Action2 {
	constructor() {
		super({
			id: 'xuanji.ai.testConnection',
			title: localize2('xuanjiAi.testConnection', "XuanJi: Test AI Connection"),
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const aiService = accessor.get(IAIService);
		const notificationService = accessor.get(INotificationService);

		notificationService.info(localize('xuanjiAi.testing', "Testing the AI connection..."));

		try {
			const options: IChatOptions = { maxTokens: 50 };
			const messages = [{ role: 'user' as const, content: 'Introduce yourself in one sentence.' }];

			let response = '';
			for await (const chunk of aiService.chat(messages, options)) {
				if (chunk.type === 'text') {
					response += chunk.content;
				} else if (chunk.type === 'error') {
					notificationService.notify({ severity: Severity.Error, message: localize('xuanjiAi.connectionFailed', "Connection failed: {0}", chunk.content) });
					return;
				}
			}

			notificationService.info(localize('xuanjiAi.connected', "Connection succeeded. Reply: {0}", response.slice(0, 100)));
		} catch (error) {
			notificationService.notify({ severity: Severity.Error, message: localize('xuanjiAi.connectionFailed', "Connection failed: {0}", getErrorMessage(error)) });
		}
	}
});

registerAction2(class ClearXuanjiChatAction extends Action2 {
	constructor() {
		super({
			id: 'xuanji.ai.clearChat',
			title: localize2('xuanjiAi.clearChat', "XuanJi: Clear Chat"),
			f1: true,
			icon: Codicon.clearAll,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Delete,
				weight: KeybindingWeight.WorkbenchContrib,
			},
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				when: ContextKeyExpr.equals('view', XUANJI_CHAT_VIEW_ID),
				order: 90,
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = viewsService.getActiveViewWithId(XUANJI_CHAT_VIEW_ID);
		if (view instanceof XuanjiChatViewPane) {
			view.clearChat();
		}
	}
});

registerAction2(class StopXuanjiGenerationAction extends Action2 {
	constructor() {
		super({
			id: 'xuanji.ai.stopGeneration',
			title: localize2('xuanjiAi.stopGeneration', "XuanJi: Stop Generation"),
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = viewsService.getActiveViewWithId(XUANJI_CHAT_VIEW_ID);
		if (view instanceof XuanjiChatViewPane) {
			view.stopGeneration();
		}
	}
});
