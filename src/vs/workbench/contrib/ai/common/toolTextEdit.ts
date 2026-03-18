/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IApplyTextEditResult {
	readonly content: string;
	readonly replacements: number;
}

export function applyTextEdit(original: string, oldText: string, newText: string, replaceAll: boolean = false): IApplyTextEditResult {
	if (!oldText) {
		throw new Error('edit_file requires a non-empty oldText value.');
	}

	if (!replaceAll) {
		const index = original.indexOf(oldText);
		if (index === -1) {
			throw new Error('edit_file could not find the target text in the file.');
		}

		return {
			content: `${original.slice(0, index)}${newText}${original.slice(index + oldText.length)}`,
			replacements: 1,
		};
	}

	let result = '';
	let searchIndex = 0;
	let replacements = 0;

	while (searchIndex < original.length) {
		const matchIndex = original.indexOf(oldText, searchIndex);
		if (matchIndex === -1) {
			break;
		}

		result += original.slice(searchIndex, matchIndex);
		result += newText;
		searchIndex = matchIndex + oldText.length;
		replacements++;
	}

	if (!replacements) {
		throw new Error('edit_file could not find the target text in the file.');
	}

	result += original.slice(searchIndex);
	return { content: result, replacements };
}
