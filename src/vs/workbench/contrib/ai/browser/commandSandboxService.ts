/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICommandExecutionRequest, ICommandExecutionResult, ICommandSandboxService } from '../common/commandSandboxService.js';
import { assessCommandPolicy, DEFAULT_ALLOWED_COMMANDS, DEFAULT_BLOCKED_PATTERNS, DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_SANDBOX_MODE } from '../common/commandSandboxPolicy.js';
import { XuanjiAiSettings } from '../../../../platform/ai/common/aiSettings.js';

const DESKTOP_REQUIRED_MSG = 'Command execution requires the desktop build of XuanJi IDE.';

export class BrowserCommandSandboxService implements ICommandSandboxService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) { }

	assessCommand(command: string) {
		return assessCommandPolicy(command, {
			mode: this._configurationService.getValue(XuanjiAiSettings.SandboxMode) || DEFAULT_SANDBOX_MODE,
			allowedCommands: this._configurationService.getValue<string[]>(XuanjiAiSettings.AllowedCommands) || [...DEFAULT_ALLOWED_COMMANDS],
			blockedPatterns: this._configurationService.getValue<string[]>(XuanjiAiSettings.BlockedPatterns) || [...DEFAULT_BLOCKED_PATTERNS],
			timeoutMs: this._configurationService.getValue<number>(XuanjiAiSettings.CommandTimeoutMs) || DEFAULT_COMMAND_TIMEOUT_MS,
		});
	}

	async executeCommand(_request: ICommandExecutionRequest, _token: CancellationToken): Promise<ICommandExecutionResult> {
		throw new Error(DESKTOP_REQUIRED_MSG);
	}
}
