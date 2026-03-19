/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { registerAction2, Action2 } from '../../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { ViewPaneContainer } from '../../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainerLocation, Extensions as ViewExtensions } from '../../../../common/views.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { XUANJI_AGENT_CONTAINER_ID, XUANJI_AGENT_VIEW_ID, XuanjiAgentViewPane } from './agentViewPane.js';

const xuanjiAgentIcon = registerIcon('xuanji-agent-icon', Codicon.listTree, localize('xuanjiAgentIcon', 'Icon for the XuanJi agent task view.'));

const xuanjiAgentViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: XUANJI_AGENT_CONTAINER_ID,
	title: localize2('xuanjiAgent.viewContainer', 'XuanJi Agent'),
	icon: xuanjiAgentIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [XUANJI_AGENT_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: XUANJI_AGENT_CONTAINER_ID,
	hideIfEmpty: false,
	order: 101,
}, ViewContainerLocation.AuxiliaryBar);

const xuanjiAgentViewDescriptor: IViewDescriptor = {
	id: XUANJI_AGENT_VIEW_ID,
	containerIcon: xuanjiAgentViewContainer.icon,
	containerTitle: xuanjiAgentViewContainer.title.value,
	singleViewPaneContainerTitle: xuanjiAgentViewContainer.title.value,
	name: localize2('xuanjiAgent.view', 'XuanJi Agent Tasks'),
	canToggleVisibility: false,
	canMoveView: true,
	ctorDescriptor: new SyncDescriptor(XuanjiAgentViewPane),
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([xuanjiAgentViewDescriptor], xuanjiAgentViewContainer);

registerAction2(class FocusXuanjiAgentAction extends Action2 {
	constructor() {
		super({
			id: 'xuanji.ai.focusAgent',
			title: localize2('xuanjiAi.focusAgent', 'XuanJi: Focus Agent Tasks'),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyJ,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		await viewsService.openView(XUANJI_AGENT_VIEW_ID, true);
	}
});
