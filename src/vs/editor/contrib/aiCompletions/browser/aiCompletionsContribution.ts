/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerEditorFeature } from '../../../../editor/common/editorFeatures.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IAIService } from '../../../../platform/ai/common/aiService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { XuanjiInlineCompletionsProvider } from './aiCompletionsProvider.js';

export class AiCompletionsContribution extends Disposable {

	static readonly ID = 'editor.contrib.xuanjiAiCompletions';

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IAIService aiService: IAIService,
		@IConfigurationService configService: IConfigurationService,
		@ILogService logService: ILogService,
	) {
		super();

		const provider = new XuanjiInlineCompletionsProvider(aiService, configService, logService);
		this._register(languageFeaturesService.inlineCompletionsProvider.register('*', provider));
	}
}

registerEditorFeature(AiCompletionsContribution);
