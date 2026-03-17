/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { parseMdcFile } from './mdcParser.js';
import { IMdcRule } from './rulesTypes.js';

const MAX_RULES_CHARS = 120_000;

export class XuanjiRulesEngine {

	constructor(
		private readonly _fileService: IFileService,
		private readonly _workspaceService: IWorkspaceContextService,
		private readonly _logService: ILogService,
	) { }

	async collectRules(activeFilePath?: string): Promise<string> {
		const folders = this._workspaceService.getWorkspace().folders;
		if (folders.length === 0) {
			return '';
		}

		const rootUri = folders[0].uri;
		const allRules: IMdcRule[] = [];

		await this._loadSingleFile(rootUri, '.cursorrules', allRules);
		await this._loadSingleFile(rootUri, 'CLAUDE.md', allRules);
		await this._loadMdcDirectory(rootUri, allRules);

		if (allRules.length === 0) {
			return '';
		}

		const applicableRules = allRules.filter(rule => {
			if (rule.alwaysApply) {
				return true;
			}
			return !!activeFilePath && rule.globs.length > 0 && this._matchGlobs(activeFilePath, rule.globs);
		});

		if (applicableRules.length === 0) {
			return '';
		}

		applicableRules.sort((left, right) => right.priority - left.priority);
		return this._mergeRules(applicableRules);
	}

	private async _loadSingleFile(rootUri: URI, fileName: string, rules: IMdcRule[]): Promise<void> {
		const resource = URI.joinPath(rootUri, fileName);
		try {
			const content = await this._fileService.readFile(resource);
			const text = content.value.toString().trim();
			if (!text) {
				return;
			}

			rules.push({
				description: `Loaded from ${fileName}`,
				globs: [],
				alwaysApply: true,
				priority: fileName === '.cursorrules' ? 100 : 90,
				body: text,
				source: fileName,
			});
		} catch {
			// Ignore missing files.
		}
	}

	private async _loadMdcDirectory(rootUri: URI, rules: IMdcRule[]): Promise<void> {
		const directory = URI.joinPath(rootUri, '.ai-ide/rules');
		try {
			const stat = await this._fileService.resolve(directory);
			const children = stat.children || [];
			for (const child of children) {
				if (child.isDirectory || !child.name.endsWith('.mdc')) {
					continue;
				}

				try {
					const content = await this._fileService.readFile(child.resource);
					rules.push(parseMdcFile(content.value.toString(), child.name));
				} catch (error) {
					this._logService.warn(`[XuanJi Rules] Failed to read rule file ${child.name}.`, error);
				}
			}
		} catch {
			// Ignore missing directories.
		}
	}

	private _matchGlobs(filePath: string, globs: readonly string[]): boolean {
		const normalizedPath = filePath.replace(/\\/g, '/');
		return globs.some(glob => this._matchSingleGlob(normalizedPath, glob));
	}

	private _matchSingleGlob(filePath: string, glob: string): boolean {
		const pattern = glob
			.replace(/\./g, '\\.')
			.replace(/\*\*/g, '<<<GLOBSTAR>>>')
			.replace(/\*/g, '[^/]*')
			.replace(/<<<GLOBSTAR>>>/g, '.*');

		if (!glob.includes('/')) {
			const fileName = filePath.split('/').pop() || '';
			return new RegExp(`^${pattern}$`).test(fileName);
		}

		return new RegExp(`${pattern}$`).test(filePath);
	}

	private _mergeRules(rules: readonly IMdcRule[]): string {
		const parts: string[] = [];
		let totalChars = 0;

		for (const rule of rules) {
			const ruleText = rule.description ? `## ${rule.description}\n${rule.body}` : rule.body;
			if (totalChars + ruleText.length > MAX_RULES_CHARS) {
				this._logService.info(`[XuanJi Rules] Reached the rule size budget. Skipping ${rule.source}.`);
				break;
			}

			parts.push(ruleText);
			totalChars += ruleText.length;
		}

		return parts.join('\n\n');
	}
}
