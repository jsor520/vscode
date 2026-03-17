/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { registerAction2, Action2 } from '../../../../../platform/actions/common/actions.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../../editor/browser/editorExtensions.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { localize2 } from '../../../../../nls.js';
import { XuanjiInlineEditController } from './xuanjiInlineEditController.js';

registerEditorContribution(
	XuanjiInlineEditController.ID,
	XuanjiInlineEditController,
	EditorContributionInstantiation.Lazy,
);

registerAction2(class StartXuanjiInlineEditAction extends Action2 {
	constructor() {
		super({
			id: 'xuanji.ai.inlineEdit',
			title: localize2('xuanjiAi.inlineEdit', "XuanJi: Inline Edit"),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyK,
				weight: KeybindingWeight.EditorContrib,
			},
		});
	}

	override run(accessor: ServicesAccessor): void {
		const editorService = accessor.get(ICodeEditorService);
		const editor = editorService.getFocusedCodeEditor();
		if (!editor) {
			return;
		}

		XuanjiInlineEditController.get(editor)?.start();
	}
});

registerAction2(class AcceptXuanjiInlineEditAction extends Action2 {
	constructor() {
		super({
			id: 'xuanji.ai.inlineEdit.accept',
			title: localize2('xuanjiAi.inlineEditAccept', "XuanJi: Accept Inline Edit"),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				weight: KeybindingWeight.EditorContrib + 10,
			},
		});
	}

	override run(accessor: ServicesAccessor): void {
		const editorService = accessor.get(ICodeEditorService);
		const editor = editorService.getFocusedCodeEditor();
		if (!editor) {
			return;
		}

		XuanjiInlineEditController.get(editor)?.accept();
	}
});

registerAction2(class RejectXuanjiInlineEditAction extends Action2 {
	constructor() {
		super({
			id: 'xuanji.ai.inlineEdit.reject',
			title: localize2('xuanjiAi.inlineEditReject', "XuanJi: Reject Inline Edit"),
			keybinding: {
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib + 10,
			},
		});
	}

	override run(accessor: ServicesAccessor): void {
		const editorService = accessor.get(ICodeEditorService);
		const editor = editorService.getFocusedCodeEditor();
		if (!editor) {
			return;
		}

		XuanjiInlineEditController.get(editor)?.reject();
	}
});
