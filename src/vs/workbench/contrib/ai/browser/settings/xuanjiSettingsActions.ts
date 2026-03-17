/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { registerAction2, Action2 } from '../../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { EditorExtensions } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { XuanjiSettingsEditor } from './xuanjiSettingsEditor.js';
import { XuanjiSettingsInput } from './xuanjiSettingsInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		XuanjiSettingsEditor,
		XuanjiSettingsEditor.ID,
		localize('xuanjiSettings', "XuanJi Settings"),
	),
	[new SyncDescriptor(XuanjiSettingsInput)],
);

registerAction2(class OpenXuanjiSettingsAction extends Action2 {
	constructor() {
		super({
			id: 'xuanji.ai.openSettings',
			title: localize2('xuanjiAi.openSettings', "XuanJi: Open AI Settings"),
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const input = instantiationService.createInstance(XuanjiSettingsInput);
		await editorService.openEditor(input);
	}
});
