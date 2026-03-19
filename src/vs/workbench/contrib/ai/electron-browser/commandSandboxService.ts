/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { clamp } from '../../../../base/common/numbers.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { XuanjiAiSettings } from '../../../../platform/ai/common/aiSettings.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProcessService } from '../../../../platform/process/common/process.js';
import { ICommandExecutionProgress, ICommandExecutionRequest, ICommandExecutionResult, ICommandSandboxService } from '../common/commandSandboxService.js';
import { assessCommandPolicy, DEFAULT_ALLOWED_COMMANDS, DEFAULT_BLOCKED_PATTERNS, DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_SANDBOX_MODE, ICommandSandboxAssessment, ICommandSandboxConfig, XuanjiSandboxMode } from '../common/commandSandboxPolicy.js';

export class ElectronCommandSandboxService implements ICommandSandboxService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IProcessService private readonly _processService: IProcessService,
	) { }

	assessCommand(command: string): ICommandSandboxAssessment {
		return assessCommandPolicy(command, this._getConfig());
	}

	async executeCommand(request: ICommandExecutionRequest, token: CancellationToken, onProgress?: (progress: ICommandExecutionProgress) => void): Promise<ICommandExecutionResult> {
		const config = this._getConfig();
		const command = request.command.trim();
		if (!command) {
			throw new Error('run_command requires a non-empty command.');
		}

		const commandId = generateUuid();
		const timeoutMs = clamp(request.timeoutMs ?? config.timeoutMs, 1000, 10 * 60 * 1000);
		const progressListener = Event.filter(this._processService.onDidRunCommandProgress, event => event.id === commandId)(event => {
			onProgress?.({
				command,
				cwd: request.cwd,
				stdout: event.stdout,
				stderr: event.stderr,
				durationMs: event.durationMs,
			});
		});
		const cancellationListener = token.onCancellationRequested(() => {
			void this._processService.cancelCommand(commandId);
		});

		try {
			return await this._processService.runCommand({
				id: commandId,
				command,
				cwd: request.cwd,
				timeoutMs,
			});
		} finally {
			progressListener.dispose();
			cancellationListener.dispose();
		}
	}

	private _getConfig(): ICommandSandboxConfig {
		return {
			mode: this._getSandboxMode(),
			allowedCommands: this._getStringArraySetting(XuanjiAiSettings.AllowedCommands, DEFAULT_ALLOWED_COMMANDS),
			blockedPatterns: this._getStringArraySetting(XuanjiAiSettings.BlockedPatterns, DEFAULT_BLOCKED_PATTERNS),
			timeoutMs: clamp(this._configurationService.getValue<number>(XuanjiAiSettings.CommandTimeoutMs) || DEFAULT_COMMAND_TIMEOUT_MS, 1000, 10 * 60 * 1000),
		};
	}

	private _getSandboxMode(): XuanjiSandboxMode {
		const mode = this._configurationService.getValue<string>(XuanjiAiSettings.SandboxMode);
		if (mode === 'strict' || mode === 'yolo') {
			return mode;
		}
		return DEFAULT_SANDBOX_MODE;
	}

	private _getStringArraySetting(setting: string, fallback: readonly string[]): string[] {
		const value = this._configurationService.getValue<unknown>(setting);
		if (!Array.isArray(value)) {
			return [...fallback];
		}
		const entries = value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).map(entry => entry.trim());
		return entries.length ? entries : [...fallback];
	}
}
