/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import * as paths from '../../../../../base/common/path.js';
import { basename, dirname, relativePath } from '../../../../../base/common/resources.js';
import Severity from '../../../../../base/common/severity.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { XuanjiAiSettings } from '../../../../../platform/ai/common/aiSettings.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { QueryBuilder } from '../../../../services/search/common/queryBuilder.js';
import { ISearchService, resultIsMatch } from '../../../../services/search/common/search.js';
import { ICommandExecutionProgress, ICommandExecutionResult, ICommandSandboxService } from '../../common/commandSandboxService.js';
import { ICommandSandboxAssessment } from '../../common/commandSandboxPolicy.js';
import { applyTextEdit } from '../../common/toolTextEdit.js';
import { IToolExecutionContext, IToolRegistry, IXuanjiTool } from '../../common/toolRegistry.js';

interface IPathToolInput {
	readonly path?: string;
}

interface IReadFileInput extends IPathToolInput {
	readonly maxChars?: number;
}

interface IListDirectoryInput extends IPathToolInput {
	readonly recursive?: boolean;
	readonly maxEntries?: number;
}

interface ISearchFilesInput {
	readonly pattern: string;
	readonly maxResults?: number;
}

interface ISearchCodeInput {
	readonly query: string;
	readonly caseSensitive?: boolean;
	readonly isRegExp?: boolean;
	readonly maxResults?: number;
}

interface IWriteFileInput extends IPathToolInput {
	readonly content: string;
	readonly overwrite?: boolean;
}

interface IEditFileInput extends IPathToolInput {
	readonly oldText: string;
	readonly newText: string;
	readonly replaceAll?: boolean;
}

interface IAskUserInput {
	readonly question: string;
	readonly placeHolder?: string;
	readonly value?: string;
	readonly password?: boolean;
}

interface IRunCommandInput {
	readonly command: string;
	readonly cwd?: string;
	readonly timeoutMs?: number;
}

const DEFAULT_READ_FILE_MAX_CHARS = 16_000;
const DEFAULT_LIST_DIRECTORY_MAX_ENTRIES = 200;
const DEFAULT_SEARCH_MAX_RESULTS = 50;
const PREVIEW_MAX_CHARS = 600;
const COMMAND_OUTPUT_PREVIEW_MAX_CHARS = 16_000;

export class XuanjiToolRegistryContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.xuanjiToolRegistry';

	private readonly _queryBuilder: QueryBuilder;

	constructor(
		@IToolRegistry private readonly _toolRegistry: IToolRegistry,
		@IFileService private readonly _fileService: IFileService,
		@ISearchService private readonly _searchService: ISearchService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@ICommandSandboxService private readonly _commandSandboxService: ICommandSandboxService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this._queryBuilder = instantiationService.createInstance(QueryBuilder);

		this._toolRegistry.registerTool(this._createReadFileTool());
		this._toolRegistry.registerTool(this._createListDirectoryTool());
		this._toolRegistry.registerTool(this._createSearchFilesTool());
		this._toolRegistry.registerTool(this._createSearchCodeTool());
		this._toolRegistry.registerTool(this._createWriteFileTool());
		this._toolRegistry.registerTool(this._createEditFileTool());
		this._toolRegistry.registerTool(this._createRunCommandTool());
		this._toolRegistry.registerTool(this._createAskUserTool());
	}

	private _createReadFileTool(): IXuanjiTool {
		return {
			name: 'read_file',
			description: 'Read a file from the current workspace.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'A workspace-relative path, absolute path, or file:// URI.' },
					maxChars: { type: 'number', minimum: 1, description: 'Maximum number of characters to return.' },
				},
				required: ['path'],
			},
			execute: async (rawInput, token) => {
				const input = rawInput as IReadFileInput;
				const resource = this._resolvePath(input.path);
				const content = await this._fileService.readFile(resource, undefined, token);
				const maxChars = this._clampNumber(input.maxChars, DEFAULT_READ_FILE_MAX_CHARS, 1, 100_000);
				const text = content.value.toString();
				const truncated = text.length > maxChars;
				const body = truncated ? text.slice(0, maxChars) : text;

				return {
					content: `${this._formatResource(resource)}\n\n${body}${truncated ? '\n\n...[truncated]' : ''}`,
				};
			},
		};
	}

	private _createListDirectoryTool(): IXuanjiTool {
		return {
			name: 'list_directory',
			description: 'List files and folders from the current workspace.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Directory path. Defaults to the workspace root.' },
					recursive: { type: 'boolean', description: 'Whether to include nested children.' },
					maxEntries: { type: 'number', minimum: 1, description: 'Maximum number of entries to return.' },
				},
			},
			execute: async (rawInput, token) => {
				const input = rawInput as IListDirectoryInput;
				const resource = this._resolvePath(input.path);
				const stat = await this._fileService.resolve(resource, { resolveMetadata: true });
				if (!stat.isDirectory) {
					throw new Error(`Path "${this._formatResource(resource)}" is not a directory.`);
				}

				const maxEntries = this._clampNumber(input.maxEntries, DEFAULT_LIST_DIRECTORY_MAX_ENTRIES, 1, 1000);
				const lines: string[] = [];
				await this._collectDirectoryEntries(stat, !!input.recursive, maxEntries, lines, token, 0);

				return {
					content: lines.length
						? `${this._formatResource(resource)}\n\n${lines.join('\n')}`
						: `${this._formatResource(resource)}\n\n<empty directory>`,
				};
			},
		};
	}

	private _createSearchFilesTool(): IXuanjiTool {
		return {
			name: 'search_files',
			description: 'Find files by name or glob pattern in the current workspace.',
			inputSchema: {
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'Filename fragment or glob pattern to search for.' },
					maxResults: { type: 'number', minimum: 1, description: 'Maximum number of matches to return.' },
				},
				required: ['pattern'],
			},
			execute: async (rawInput, token) => {
				const input = rawInput as ISearchFilesInput;
				if (!input.pattern?.trim()) {
					throw new Error('search_files requires a non-empty pattern.');
				}

				const results = await this._searchService.fileSearch(
					this._queryBuilder.file(this._getWorkspaceFolderResources(), {
						filePattern: input.pattern.trim(),
						maxResults: this._clampNumber(input.maxResults, DEFAULT_SEARCH_MAX_RESULTS, 1, 200),
					}),
					token,
				);

				if (!results.results.length) {
					return { content: `No files matched "${input.pattern}".` };
				}

				return {
					content: results.results.map(result => this._formatResource(result.resource)).join('\n'),
				};
			},
		};
	}

	private _createSearchCodeTool(): IXuanjiTool {
		return {
			name: 'search_code',
			description: 'Search file contents in the current workspace.',
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Text or regular expression to search for.' },
					caseSensitive: { type: 'boolean', description: 'Whether to search case-sensitively.' },
					isRegExp: { type: 'boolean', description: 'Whether the query should be treated as a regular expression.' },
					maxResults: { type: 'number', minimum: 1, description: 'Maximum number of matches to return.' },
				},
				required: ['query'],
			},
			execute: async (rawInput, token) => {
				const input = rawInput as ISearchCodeInput;
				if (!input.query?.trim()) {
					throw new Error('search_code requires a non-empty query.');
				}

				const maxResults = this._clampNumber(input.maxResults, DEFAULT_SEARCH_MAX_RESULTS, 1, 200);
				const search = await this._searchService.textSearch(
					this._queryBuilder.text(
						{
							pattern: input.query.trim(),
							isCaseSensitive: !!input.caseSensitive,
							isRegExp: !!input.isRegExp,
						},
						this._getWorkspaceFolderResources(),
						{
							maxResults,
							previewOptions: {
								matchLines: 1,
								charsPerLine: 200,
							},
						},
					),
					token,
				);

				const lines: string[] = [];
				for (const fileMatch of search.results) {
					for (const result of fileMatch.results ?? []) {
						if (!resultIsMatch(result)) {
							continue;
						}

						const location = result.rangeLocations[0]?.source;
						const preview = result.previewText.replace(/\s+/g, ' ').trim();
						lines.push(`${this._formatResource(fileMatch.resource)}:${location?.startLineNumber ?? 1}: ${preview}`);
						if (lines.length >= maxResults) {
							return { content: lines.join('\n') };
						}
					}
				}

				return {
					content: lines.length ? lines.join('\n') : `No code matches found for "${input.query}".`,
				};
			},
		};
	}

	private _createWriteFileTool(): IXuanjiTool {
		return {
			name: 'write_file',
			description: 'Create or overwrite a file in the current workspace after confirmation.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'A workspace-relative path, absolute path, or file:// URI.' },
					content: { type: 'string', description: 'New file contents.' },
					overwrite: { type: 'boolean', description: 'Whether an existing file may be replaced.' },
				},
				required: ['path', 'content'],
			},
			execute: async rawInput => {
				const input = rawInput as IWriteFileInput;
				if (!input.path) {
					throw new Error('write_file requires a path.');
				}

				const resource = this._resolvePath(input.path);
				const exists = await this._fileService.exists(resource);
				if (exists && !input.overwrite) {
					throw new Error(`File "${this._formatResource(resource)}" already exists. Pass overwrite=true to replace it.`);
				}

				const confirmed = await this._confirmFileMutation(
					localize('xuanjiTools.writeFile.title', 'Allow AI to write a file?'),
					localize('xuanjiTools.writeFile.message', 'Write {0}?', this._formatResource(resource)),
					`${exists ? localize('xuanjiTools.writeFile.overwrite', 'This will overwrite the existing file.') : localize('xuanjiTools.writeFile.create', 'This will create a new file if needed.')}\n\n${this._createPreview(input.content)}`,
					localize('xuanjiTools.writeFile.primary', 'Write File'),
				);
				if (!confirmed) {
					return { content: 'The user cancelled the file write request.', isError: true };
				}

				await this._ensureParentDirectory(resource);
				if (exists) {
					await this._fileService.writeFile(resource, VSBuffer.fromString(input.content));
				} else {
					await this._fileService.createFile(resource, VSBuffer.fromString(input.content), { overwrite: false });
				}

				return {
					content: `Wrote ${input.content.length} characters to ${this._formatResource(resource)}.`,
				};
			},
		};
	}

	private _createEditFileTool(): IXuanjiTool {
		return {
			name: 'edit_file',
			description: 'Replace exact text in an existing file after confirmation.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'A workspace-relative path, absolute path, or file:// URI.' },
					oldText: { type: 'string', description: 'Exact text to replace.' },
					newText: { type: 'string', description: 'Replacement text.' },
					replaceAll: { type: 'boolean', description: 'Replace all occurrences instead of only the first match.' },
				},
				required: ['path', 'oldText', 'newText'],
			},
			execute: async (rawInput, token) => {
				const input = rawInput as IEditFileInput;
				if (!input.path) {
					throw new Error('edit_file requires a path.');
				}

				const resource = this._resolvePath(input.path);
				if (!await this._fileService.exists(resource)) {
					throw new Error(`File "${this._formatResource(resource)}" does not exist.`);
				}

				const original = (await this._fileService.readFile(resource, undefined, token)).value.toString();
				const result = applyTextEdit(original, input.oldText, input.newText, !!input.replaceAll);
				const confirmed = await this._confirmFileMutation(
					localize('xuanjiTools.editFile.title', 'Allow AI to edit a file?'),
					localize('xuanjiTools.editFile.message', 'Edit {0}?', this._formatResource(resource)),
					`${localize('xuanjiTools.editFile.detail', 'This will apply {0} replacement(s).', result.replacements)}\n\n${this._createPreview(input.oldText, localize('xuanjiTools.editFile.oldText', 'Old text'))}\n\n${this._createPreview(input.newText, localize('xuanjiTools.editFile.newText', 'New text'))}`,
					localize('xuanjiTools.editFile.primary', 'Apply Edit'),
				);
				if (!confirmed) {
					return { content: 'The user cancelled the file edit request.', isError: true };
				}

				await this._fileService.writeFile(resource, VSBuffer.fromString(result.content));
				return {
					content: `Updated ${this._formatResource(resource)} with ${result.replacements} replacement(s).`,
				};
			},
		};
	}

	private _createRunCommandTool(): IXuanjiTool {
		return {
			name: 'run_command',
			description: 'Execute a shell command in the current workspace using XuanJi sandbox rules.',
			inputSchema: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'Shell command to execute.' },
					cwd: { type: 'string', description: 'Optional working directory. Defaults to the first workspace folder.' },
					timeoutMs: { type: 'number', minimum: 1000, description: 'Optional timeout override in milliseconds.' },
				},
				required: ['command'],
			},
			execute: async (rawInput, token, context) => {
				const input = rawInput as IRunCommandInput;
				if (!input.command?.trim()) {
					throw new Error('run_command requires a non-empty command.');
				}

				const assessment = this._commandSandboxService.assessCommand(input.command);
				const cwd = this._resolveCommandWorkingDirectory(input.cwd);
				if (assessment.requiresConfirmation) {
					const confirmed = await this._dialogService.confirm({
						type: Severity.Warning,
						title: localize('xuanjiTools.runCommand.title', 'Allow AI to run a command?'),
						message: localize('xuanjiTools.runCommand.message', 'Run command in {0}?', cwd.fsPath),
						detail: `${this._describeCommandAssessment(assessment)}\n\n${this._createPreview(assessment.command, localize('xuanjiTools.runCommand.command', 'Command'))}`,
						primaryButton: localize('xuanjiTools.runCommand.primary', 'Run Command'),
						cancelButton: localize('xuanjiTools.cancel', 'Cancel'),
					});
					if (!confirmed.confirmed) {
						return { content: 'The user cancelled the command execution.', isError: true };
					}
				}

				this._reportCommandProgress(context, {
					command: assessment.command,
					cwd: cwd.fsPath,
					stdout: '',
					stderr: '',
					durationMs: 0,
				});

				const result = await this._commandSandboxService.executeCommand({
					command: input.command,
					cwd: cwd.fsPath,
					timeoutMs: input.timeoutMs,
				}, token, progress => this._reportCommandProgress(context, progress));

				return {
					content: this._formatCommandResult(result),
					isError: result.timedOut || (result.exitCode ?? 0) !== 0,
				};
			},
		};
	}

	private _createAskUserTool(): IXuanjiTool {
		return {
			name: 'ask_user',
			description: 'Ask the user a question when more input is required.',
			inputSchema: {
				type: 'object',
				properties: {
					question: { type: 'string', description: 'Question to ask the user.' },
					placeHolder: { type: 'string', description: 'Optional input placeholder.' },
					value: { type: 'string', description: 'Optional default value.' },
					password: { type: 'boolean', description: 'Whether to mask the answer.' },
				},
				required: ['question'],
			},
			execute: async (rawInput, token) => {
				const input = rawInput as IAskUserInput;
				if (!input.question?.trim()) {
					throw new Error('ask_user requires a non-empty question.');
				}

				const answer = await this._quickInputService.input({
					title: localize('xuanjiTools.askUser.title', 'XuanJi AI needs your input'),
					prompt: input.question,
					placeHolder: input.placeHolder,
					value: input.value,
					password: !!input.password,
					ignoreFocusLost: true,
				}, token);

				if (answer === undefined) {
					return { content: 'The user cancelled the prompt.', isError: true };
				}

				return { content: answer };
			},
		};
	}

	private _getWorkspaceFolderResources(): URI[] {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (!folders.length) {
			throw new Error('No workspace folder is currently open.');
		}

		return folders.map(folder => folder.uri);
	}

	private _resolvePath(pathValue?: string): URI {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (!folders.length) {
			throw new Error('No workspace folder is currently open.');
		}

		if (!pathValue || pathValue === '.' || pathValue === './') {
			return folders[0].uri;
		}

		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(pathValue)) {
			return URI.parse(pathValue);
		}

		if (paths.isAbsolute(pathValue) || /^[a-zA-Z]:[\\/]/.test(pathValue)) {
			return URI.file(pathValue);
		}

		const normalizedPath = pathValue.replace(/\\/g, '/').replace(/^\.\/+/, '');
		if (folders.length > 1) {
			const [folderName, ...rest] = normalizedPath.split('/');
			const workspaceFolder = folders.find(folder => folder.name === folderName);
			if (workspaceFolder) {
				return rest.length ? workspaceFolder.toResource(rest.join('/')) : workspaceFolder.uri;
			}
		}

		return folders[0].toResource(normalizedPath);
	}

	private _formatResource(resource: URI): string {
		const workspaceFolder = this._workspaceContextService.getWorkspaceFolder(resource);
		if (!workspaceFolder) {
			return resource.scheme === 'file' ? resource.fsPath : resource.toString();
		}

		const relative = relativePath(workspaceFolder.uri, resource);
		if (!relative) {
			return workspaceFolder.name;
		}

		return this._workspaceContextService.getWorkspace().folders.length > 1
			? `${workspaceFolder.name}/${relative}`
			: relative;
	}

	private async _collectDirectoryEntries(
		stat: IFileStat,
		recursive: boolean,
		maxEntries: number,
		lines: string[],
		token: CancellationToken,
		depth: number,
	): Promise<void> {
		if (!stat.children?.length || lines.length >= maxEntries) {
			return;
		}

		for (const child of [...stat.children].sort((a, b) => a.name.localeCompare(b.name))) {
			this._throwIfCancelled(token);

			lines.push(`${'  '.repeat(depth)}${basename(child.resource)}${child.isDirectory ? '/' : ''}`);
			if (lines.length >= maxEntries) {
				return;
			}

			if (recursive && child.isDirectory) {
				const resolvedChild = await this._fileService.resolve(child.resource, { resolveMetadata: true });
				await this._collectDirectoryEntries(resolvedChild, true, maxEntries, lines, token, depth + 1);
				if (lines.length >= maxEntries) {
					return;
				}
			}
		}
	}

	private _clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
		const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
		return Math.min(Math.max(candidate, min), max);
	}

	private _throwIfCancelled(token: CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
	}

	private async _confirmFileMutation(title: string, message: string, detail: string, primaryButton: string): Promise<boolean> {
		if (this._configurationService.getValue<boolean>(XuanjiAiSettings.AutoApproveFileEdits)) {
			return true;
		}

		const result = await this._dialogService.confirm({
			type: Severity.Warning,
			title,
			message,
			detail,
			primaryButton,
			cancelButton: localize('xuanjiTools.cancel', 'Cancel'),
		});
		return result.confirmed;
	}

	private _createPreview(content: string, title?: string): string {
		const normalized = content.length > PREVIEW_MAX_CHARS ? `${content.slice(0, PREVIEW_MAX_CHARS)}\n...[truncated]` : content;
		return title ? `${title}:\n${normalized}` : normalized;
	}

	private async _ensureParentDirectory(resource: URI): Promise<void> {
		const parent = dirname(resource);
		if (parent.toString() === resource.toString()) {
			return;
		}
		if (await this._fileService.exists(parent)) {
			return;
		}

		await this._fileService.createFolder(parent);
	}

	private _resolveCommandWorkingDirectory(cwd?: string): URI {
		const resource = cwd ? this._resolvePath(cwd) : this._getWorkspaceFolderResources()[0];
		if (resource.scheme !== 'file') {
			throw new Error('run_command currently supports only local file-system workspaces.');
		}
		return resource;
	}

	private _describeCommandAssessment(assessment: ICommandSandboxAssessment): string {
		switch (assessment.reason) {
			case 'blocked-pattern':
				return localize('xuanjiTools.runCommand.reason.blocked', 'This command matches a blocked pattern: {0}', assessment.matchedBlockedPattern);
			case 'strict':
				return localize('xuanjiTools.runCommand.reason.strict', 'Sandbox mode is strict, so all commands require confirmation.');
			case 'unlisted':
				return localize('xuanjiTools.runCommand.reason.unlisted', 'This command is not in the safe allowlist and requires approval.');
			case 'allowed':
				return localize('xuanjiTools.runCommand.reason.allowed', 'This command is allowlisted.');
			case 'yolo':
				return localize('xuanjiTools.runCommand.reason.yolo', 'Sandbox mode is yolo, so the command is auto-approved.');
			default:
				return localize('xuanjiTools.runCommand.reason.default', 'The command requires confirmation.');
		}
	}

	private _formatCommandResult(result: ICommandExecutionResult): string {
		return this._formatCommandSnapshot({
			command: result.command,
			cwd: result.cwd,
			durationMs: result.durationMs,
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
			signal: result.signal,
			timedOut: result.timedOut,
		});
	}

	private _reportCommandProgress(context: IToolExecutionContext | undefined, progress: ICommandExecutionProgress): void {
		context?.reportProgress({
			content: this._formatCommandSnapshot({
				command: progress.command,
				cwd: progress.cwd,
				durationMs: progress.durationMs,
				stdout: progress.stdout,
				stderr: progress.stderr,
				status: localize('xuanjiTools.runCommand.status.running', 'Running'),
			}),
		});
	}

	private _formatCommandSnapshot(options: {
		readonly command: string;
		readonly cwd?: string;
		readonly durationMs: number;
		readonly stdout: string;
		readonly stderr: string;
		readonly status?: string;
		readonly exitCode?: number | null;
		readonly signal?: string;
		readonly timedOut?: boolean;
	}): string {
		const sections = [
			`Command: ${options.command}`,
			`Working directory: ${options.cwd || '(default)'}`,
			`Duration: ${options.durationMs}ms`,
		];
		if (options.status) {
			sections.splice(2, 0, `Status: ${options.status}`);
		}
		if (options.exitCode !== undefined) {
			sections.splice(2, 0, `Exit code: ${options.exitCode ?? '(unknown)'}`);
		}
		if (options.signal) {
			sections.push(`Signal: ${options.signal}`);
		}
		if (options.timedOut) {
			sections.push('Timed out: true');
		}
		if (options.stdout) {
			sections.push(`Stdout:\n\n\`\`\`text\n${this._truncateCommandOutput(options.stdout)}\n\`\`\``);
		}
		if (options.stderr) {
			sections.push(`Stderr:\n\n\`\`\`text\n${this._truncateCommandOutput(options.stderr)}\n\`\`\``);
		}
		if (!options.stdout && !options.stderr) {
			sections.push(options.status
				? localize('xuanjiTools.runCommand.waitingOutput', 'Waiting for command output...')
				: 'No output was produced.');
		}
		return sections.join('\n\n');
	}

	private _truncateCommandOutput(output: string): string {
		if (output.length <= COMMAND_OUTPUT_PREVIEW_MAX_CHARS) {
			return output;
		}
		return `${output.slice(0, COMMAND_OUTPUT_PREVIEW_MAX_CHARS)}\n...[truncated]`;
	}
}
