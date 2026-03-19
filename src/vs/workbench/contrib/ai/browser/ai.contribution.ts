/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './settings/aiSettingsContribution.js';
import './settings/media/xuanjiSettings.css';
import './settings/xuanjiSettingsActions.js';
import '../../../../editor/contrib/aiCompletions/browser/aiCompletions.contribution.js';
import './agent/agentActions.js';
import './agent/media/agentPanel.css';
import './chat/xuanjiChatActions.js';
import './inlineEdit/xuanjiInlineEditActions.js';

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAIService } from '../../../../platform/ai/common/aiService.js';
import { AICredentialsService, IAICredentialsService } from '../../../../platform/ai/common/aiCredentialsService.js';
import { BrowserAIServiceImpl } from '../../../../platform/ai/common/aiServiceImpl.js';
import { IXuanjiAgentService, XuanjiAgentController } from './agent/agentController.js';
import { ICommandSandboxService } from '../common/commandSandboxService.js';
import { BrowserCommandSandboxService } from './commandSandboxService.js';
import { IToolRegistry, ToolRegistry } from '../common/toolRegistry.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { XuanjiToolRegistryContribution } from './tools/xuanjiToolRegistryContribution.js';

registerSingleton(IAICredentialsService, AICredentialsService, InstantiationType.Delayed);
registerSingleton(IAIService, BrowserAIServiceImpl, InstantiationType.Delayed);
registerSingleton(IToolRegistry, ToolRegistry, InstantiationType.Delayed);
registerSingleton(ICommandSandboxService, BrowserCommandSandboxService, InstantiationType.Delayed);
registerSingleton(IXuanjiAgentService, XuanjiAgentController, InstantiationType.Delayed);

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

registerWorkbenchContribution2(
	XuanjiToolRegistryContribution.ID,
	XuanjiToolRegistryContribution,
	WorkbenchPhase.AfterRestored,
);
