/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { URI } from '../../../../../base/common/uri.js';
import { EditorInputCapabilities } from '../../../../common/editor.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Codicon } from '../../../../../base/common/codicons.js';

export class XuanjiSettingsInput extends EditorInput {

	static readonly ID = 'workbench.editors.xuanjiSettings';
	static readonly RESOURCE = URI.from({ scheme: 'xuanji-settings', authority: 'main' });

	override get typeId(): string {
		return XuanjiSettingsInput.ID;
	}

	get resource(): URI | undefined {
		return XuanjiSettingsInput.RESOURCE;
	}

	override get editorId(): string | undefined {
		return this.typeId;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('xuanjiSettings', "XuanJi Settings");
	}

	override getIcon(): ThemeIcon | undefined {
		return Codicon.settingsGear;
	}

	override matches(other: EditorInput): boolean {
		return other instanceof XuanjiSettingsInput;
	}
}
