/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandSandboxAssessment } from './commandSandboxPolicy.js';

export const ICommandSandboxService = createDecorator<ICommandSandboxService>('xuanjiCommandSandboxService');

export interface ICommandExecutionRequest {
	readonly command: string;
	readonly cwd?: string;
	readonly timeoutMs?: number;
}

export interface ICommandExecutionResult {
	readonly command: string;
	readonly cwd?: string;
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number | null;
	readonly signal?: string;
	readonly timedOut: boolean;
	readonly durationMs: number;
}

export interface ICommandExecutionProgress {
	readonly command: string;
	readonly cwd?: string;
	readonly stdout: string;
	readonly stderr: string;
	readonly durationMs: number;
}

export interface ICommandSandboxService {
	readonly _serviceBrand: undefined;

	assessCommand(command: string): ICommandSandboxAssessment;
	executeCommand(request: ICommandExecutionRequest, token: CancellationToken, onProgress?: (progress: ICommandExecutionProgress) => void): Promise<ICommandExecutionResult>;
}
