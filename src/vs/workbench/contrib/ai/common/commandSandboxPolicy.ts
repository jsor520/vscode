/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type XuanjiSandboxMode = 'standard' | 'strict' | 'yolo';

export interface ICommandSandboxConfig {
	readonly mode: XuanjiSandboxMode;
	readonly allowedCommands: readonly string[];
	readonly blockedPatterns: readonly string[];
	readonly timeoutMs: number;
}

export interface ICommandSandboxAssessment {
	readonly command: string;
	readonly mode: XuanjiSandboxMode;
	readonly requiresConfirmation: boolean;
	readonly matchedAllowedCommand?: string;
	readonly matchedBlockedPattern?: string;
	readonly reason: 'allowed' | 'strict' | 'blocked-pattern' | 'unlisted' | 'yolo';
}

export const DEFAULT_SANDBOX_MODE: XuanjiSandboxMode = 'standard';
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
export const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
	'pwd',
	'ls',
	'dir',
	'Get-ChildItem',
	'rg',
	'git status',
	'git diff',
	'git log',
	'npm',
	'pnpm',
	'yarn',
	'node',
	'python',
	'py',
	'where',
	'which',
	'cat',
	'type',
	'echo',
];
export const DEFAULT_BLOCKED_PATTERNS: readonly string[] = [
	'rm -rf',
	'rm -r /',
	'git push --force',
	'git reset --hard',
	'sudo ',
	'su ',
	'> /dev/sda',
	'Remove-Item -Recurse -Force',
	'del /f /q',
	'format ',
	'shutdown ',
	'reboot ',
];

export function assessCommandPolicy(command: string, config: ICommandSandboxConfig): ICommandSandboxAssessment {
	const normalizedCommand = normalizeCommand(command);
	const mode = config.mode;
	const matchedBlockedPattern = config.blockedPatterns.find(pattern => includesIgnoreCase(normalizedCommand, pattern));
	const matchedAllowedCommand = config.allowedCommands.find(prefix => matchesCommandPrefix(normalizedCommand, prefix));

	if (mode === 'yolo') {
		return {
			command: normalizedCommand,
			mode,
			requiresConfirmation: false,
			matchedAllowedCommand,
			matchedBlockedPattern,
			reason: 'yolo',
		};
	}

	if (matchedBlockedPattern) {
		return {
			command: normalizedCommand,
			mode,
			requiresConfirmation: true,
			matchedBlockedPattern,
			matchedAllowedCommand,
			reason: 'blocked-pattern',
		};
	}

	if (mode === 'strict') {
		return {
			command: normalizedCommand,
			mode,
			requiresConfirmation: true,
			matchedAllowedCommand,
			reason: 'strict',
		};
	}

	if (matchedAllowedCommand) {
		return {
			command: normalizedCommand,
			mode,
			requiresConfirmation: false,
			matchedAllowedCommand,
			reason: 'allowed',
		};
	}

	return {
		command: normalizedCommand,
		mode,
		requiresConfirmation: true,
		reason: 'unlisted',
	};
}

export function normalizeCommand(command: string): string {
	return command.trim().replace(/\s+/g, ' ');
}

export function matchesCommandPrefix(command: string, prefix: string): boolean {
	const normalizedCommand = normalizeCommand(command).toLowerCase();
	const normalizedPrefix = normalizeCommand(prefix).toLowerCase();
	if (!normalizedCommand.startsWith(normalizedPrefix)) {
		return false;
	}
	if (normalizedCommand.length === normalizedPrefix.length) {
		return true;
	}
	const nextChar = normalizedCommand.charAt(normalizedPrefix.length);
	return nextChar === ' ' || nextChar === '\t';
}

function includesIgnoreCase(haystack: string, needle: string): boolean {
	return haystack.toLowerCase().includes(needle.toLowerCase());
}
