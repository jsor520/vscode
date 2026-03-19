/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { ProcessItem } from '../../../base/common/processes.js';
import { clamp } from '../../../base/common/numbers.js';
import { IProcessEnvironment, isWindows, OS } from '../../../base/common/platform.js';
import { killTree } from '../../../base/node/processes.js';
import { listProcesses } from '../../../base/node/ps.js';
import { getSystemShell } from '../../../base/node/shell.js';
import { localize } from '../../../nls.js';
import { IDiagnosticsService, IRemoteDiagnosticError, isRemoteDiagnosticError, PerformanceInfo, SystemInfo } from '../../diagnostics/common/diagnostics.js';
import { IDiagnosticsMainService } from '../../diagnostics/electron-main/diagnosticsMainService.js';
import { ILogService } from '../../log/common/log.js';
import { UtilityProcess } from '../../utilityProcess/electron-main/utilityProcess.js';
import { IProcessCommandRequest, IProcessCommandResult, IProcessService, IResolvedProcessInformation } from '../common/process.js';

const MAX_OUTPUT_LENGTH = 120_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

interface IRunningCommand {
	readonly child: ChildProcessWithoutNullStreams;
	readonly markCancelled: () => void;
}

function getShellArgs(shellPath: string, command: string): string[] {
	const normalized = shellPath.toLowerCase();
	if (normalized.includes('pwsh') || normalized.includes('powershell')) {
		return ['-NoProfile', '-NonInteractive', '-Command', command];
	}
	if (isWindows) {
		return ['/d', '/c', command];
	}
	return ['-lc', command];
}

async function killProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (!child.pid) {
		child.kill();
		return;
	}

	try {
		await killTree(child.pid, true);
	} catch {
		child.kill();
	}
}

export class ProcessMainService implements IProcessService {

	declare readonly _serviceBrand: undefined;
	private readonly _runningCommands = new Map<string, IRunningCommand>();
	private readonly _pendingCancelledCommands = new Set<string>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@IDiagnosticsService private readonly diagnosticsService: IDiagnosticsService,
		@IDiagnosticsMainService private readonly diagnosticsMainService: IDiagnosticsMainService
	) {
	}

	async resolveProcesses(): Promise<IResolvedProcessInformation> {
		const mainProcessInfo = await this.diagnosticsMainService.getMainDiagnostics();

		const pidToNames: [number, string][] = [];
		for (const window of mainProcessInfo.windows) {
			pidToNames.push([window.pid, `window [${window.id}] (${window.title})`]);
		}

		for (const { pid, name } of UtilityProcess.getAll()) {
			pidToNames.push([pid, name]);
		}

		const processes: { name: string; rootProcess: ProcessItem | IRemoteDiagnosticError }[] = [];
		try {
			processes.push({ name: localize('local', "Local"), rootProcess: await listProcesses(process.pid) });

			const remoteDiagnostics = await this.diagnosticsMainService.getRemoteDiagnostics({ includeProcesses: true });
			remoteDiagnostics.forEach(data => {
				if (isRemoteDiagnosticError(data)) {
					processes.push({
						name: data.hostName,
						rootProcess: data
					});
				} else {
					if (data.processes) {
						processes.push({
							name: data.hostName,
							rootProcess: data.processes
						});
					}
				}
			});
		} catch (e) {
			this.logService.error(`Listing processes failed: ${e}`);
		}

		return { pidToNames, processes };
	}

	async getSystemStatus(): Promise<string> {
		const [info, remoteData] = await Promise.all([this.diagnosticsMainService.getMainDiagnostics(), this.diagnosticsMainService.getRemoteDiagnostics({ includeProcesses: false, includeWorkspaceMetadata: false })]);

		return this.diagnosticsService.getDiagnostics(info, remoteData);
	}

	async getSystemInfo(): Promise<SystemInfo> {
		const [info, remoteData] = await Promise.all([this.diagnosticsMainService.getMainDiagnostics(), this.diagnosticsMainService.getRemoteDiagnostics({ includeProcesses: false, includeWorkspaceMetadata: false })]);
		const msg = await this.diagnosticsService.getSystemInfo(info, remoteData);

		return msg;
	}

	async getPerformanceInfo(): Promise<PerformanceInfo> {
		try {
			const [info, remoteData] = await Promise.all([this.diagnosticsMainService.getMainDiagnostics(), this.diagnosticsMainService.getRemoteDiagnostics({ includeProcesses: true, includeWorkspaceMetadata: true })]);
			return await this.diagnosticsService.getPerformanceInfo(info, remoteData);
		} catch (error) {
			this.logService.warn('issueService#getPerformanceInfo ', error.message);

			throw error;
		}
	}

	async runCommand(request: IProcessCommandRequest): Promise<IProcessCommandResult> {
		const command = request.command.trim();
		if (!command) {
			throw new Error('run_command requires a non-empty command.');
		}

		const timeoutMs = clamp(request.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, 1000, 10 * 60 * 1000);
		const shell = await getSystemShell(OS, process.env as IProcessEnvironment);
		const args = getShellArgs(shell, command);
		const startedAt = Date.now();

		return new Promise<IProcessCommandResult>((resolve, reject) => {
			let stdout = '';
			let stderr = '';
			let timedOut = false;
			let settled = false;
			let cancelled = false;
			const timeoutHandle = { value: undefined as ReturnType<typeof setTimeout> | undefined };
			let child: ChildProcessWithoutNullStreams;

			const append = (current: string, chunk: Buffer): string => {
				const next = current + chunk.toString();
				if (next.length <= MAX_OUTPUT_LENGTH) {
					return next;
				}
				return `${next.slice(0, MAX_OUTPUT_LENGTH)}\n...[truncated]`;
			};

			const cleanup = () => {
				if (timeoutHandle.value) {
					clearTimeout(timeoutHandle.value);
				}
				this._runningCommands.delete(request.id);
				this._pendingCancelledCommands.delete(request.id);
			};

			const finish = (exitCode: number | null, signal?: string) => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				resolve({
					command,
					cwd: request.cwd,
					stdout,
					stderr,
					exitCode,
					signal,
					timedOut,
					durationMs: Date.now() - startedAt,
				});
			};

			const fail = (error: unknown) => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				reject(error);
			};

			const markCancelled = () => {
				if (cancelled) {
					return;
				}
				cancelled = true;
				stderr = `${stderr}${stderr ? '\n' : ''}Command cancelled.`;
			};

			try {
				this.logService.info('[XuanJi AI] Running sandboxed command.', { command, cwd: request.cwd, shell });
				child = spawn(shell, args, {
					cwd: request.cwd,
					env: process.env,
					windowsHide: true,
				});
			} catch (error) {
				fail(error);
				return;
			}

			this._runningCommands.set(request.id, { child, markCancelled });
			if (this._pendingCancelledCommands.delete(request.id)) {
				markCancelled();
				void killProcessTree(child);
			}

			child.stdout.on('data', data => {
				stdout = append(stdout, data);
			});
			child.stderr.on('data', data => {
				stderr = append(stderr, data);
			});
			child.on('error', error => {
				fail(error);
			});
			child.on('close', (exitCode, signal) => {
				finish(exitCode, signal ?? undefined);
			});

			timeoutHandle.value = setTimeout(() => {
				timedOut = true;
				stderr = `${stderr}${stderr ? '\n' : ''}Command timed out after ${timeoutMs}ms.`;
				void killProcessTree(child);
			}, timeoutMs);
		});
	}

	async cancelCommand(id: string): Promise<void> {
		const runningCommand = this._runningCommands.get(id);
		if (!runningCommand) {
			this._pendingCancelledCommands.add(id);
			return;
		}

		runningCommand.markCancelled();
		await killProcessTree(runningCommand.child);
	}
}



