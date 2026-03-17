/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { basename, relativePath } from '../../../../../base/common/resources.js';
import * as paths from '../../../../../base/common/path.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { QueryBuilder } from '../../../../services/search/common/queryBuilder.js';
import { ISearchService, resultIsMatch } from '../../../../services/search/common/search.js';
import { IToolRegistry, IXuanjiTool } from '../../common/toolRegistry.js';

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

const DEFAULT_READ_FILE_MAX_CHARS = 16_000;
const DEFAULT_LIST_DIRECTORY_MAX_ENTRIES = 200;
const DEFAULT_SEARCH_MAX_RESULTS = 50;

export class XuanjiToolRegistryContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.xuanjiToolRegistry';

	private readonly _queryBuilder: QueryBuilder;

	constructor(
		@IToolRegistry private readonly _toolRegistry: IToolRegistry,
		@IFileService private readonly _fileService: IFileService,
		@ISearchService private readonly _searchService: ISearchService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this._queryBuilder = instantiationService.createInstance(QueryBuilder);

		this._toolRegistry.registerTool(this._createReadFileTool());
		this._toolRegistry.registerTool(this._createListDirectoryTool());
		this._toolRegistry.registerTool(this._createSearchFilesTool());
		this._toolRegistry.registerTool(this._createSearchCodeTool());
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
					content: results.results
						.map(result => this._formatResource(result.resource))
						.join('\n'),
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
}
