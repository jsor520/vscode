/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './settings/aiSettingsContribution.js';
import './settings/media/xuanjiSettings.css';
import './settings/xuanjiSettingsActions.js';

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAIService } from '../../../../platform/ai/common/aiService.js';
import { AICredentialsService, IAICredentialsService } from '../../../../platform/ai/common/aiCredentialsService.js';
import { BrowserAIServiceImpl } from '../../../../platform/ai/common/aiServiceImpl.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILogService } from '../../../../platform/log/common/log.js';

registerSingleton(IAICredentialsService, AICredentialsService, InstantiationType.Delayed);
registerSingleton(IAIService, BrowserAIServiceImpl, InstantiationType.Delayed);

class XuanjiAICredentialsMigrationContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.xuanjiAiCredentialsMigration';

	constructor(
		@IAICredentialsService credentialsService: IAICredentialsService,
		@ILogService logService: ILogService,
	) {
		void credentialsService.migrateLegacyModelsIfNeeded().catch(error => {
			logService.error('[XuanJi AI] Failed to migrate legacy model secrets.', error);
		});
	}
}

registerWorkbenchContribution2(
	XuanjiAICredentialsMigrationContribution.ID,
	XuanjiAICredentialsMigrationContribution,
	WorkbenchPhase.AfterRestored,
);
