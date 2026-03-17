/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMdcRule } from './rulesTypes.js';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

type YamlValue = string | boolean;

export function parseMdcFile(content: string, source: string): IMdcRule {
	const match = content.match(FRONTMATTER_REGEX);

	if (!match) {
		return {
			description: '',
			globs: [],
			alwaysApply: true,
			priority: 0,
			body: content.trim(),
			source,
		};
	}

	const yaml = match[1];
	const body = match[2].trim();
	const metadata = parseSimpleYaml(yaml);

	return {
		description: typeof metadata.description === 'string' ? metadata.description : '',
		globs: parseGlobs(metadata.globs),
		alwaysApply: metadata.alwaysApply === true || metadata.alwaysApply === 'true',
		priority: Number.parseInt(String(metadata.priority || '0'), 10) || 0,
		body,
		source,
	};
}

function parseSimpleYaml(yaml: string): Record<string, YamlValue> {
	const result: Record<string, YamlValue> = {};

	for (const line of yaml.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		const colonIndex = trimmed.indexOf(':');
		if (colonIndex === -1) {
			continue;
		}

		const key = trimmed.substring(0, colonIndex).trim();
		let value: YamlValue = trimmed.substring(colonIndex + 1).trim();

		if (value === 'true') {
			result[key] = true;
			continue;
		}
		if (value === 'false') {
			result[key] = false;
			continue;
		}

		const stringValue = String(value);
		const singleQuote = String.fromCharCode(39);
		if ((stringValue.startsWith('"') && stringValue.endsWith('"')) || (stringValue.startsWith(singleQuote) && stringValue.endsWith(singleQuote))) {
			value = stringValue.slice(1, -1);
		}
		result[key] = value;
	}

	return result;
}

function parseGlobs(value: unknown): string[] {
	if (!value) {
		return [];
	}

	const stringValue = String(value).trim();
	if (!stringValue) {
		return [];
	}

	if (stringValue.startsWith('[')) {
		try {
			const parsed = JSON.parse(stringValue) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.map(item => String(item));
			}
		} catch {
			// Fall back to the other supported formats.
		}
	}

	if (stringValue.includes(',')) {
		return stringValue.split(',').map(item => item.trim()).filter(Boolean);
	}

	return [stringValue];
}
