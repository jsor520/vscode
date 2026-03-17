/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ICompletionContext } from '../../../../platform/ai/common/aiService.js';

const PREFIX_LINES = 100;
const SUFFIX_LINES = 50;

export function collectCompletionContext(
	model: ITextModel,
	position: Position,
): ICompletionContext {
	const lineCount = model.getLineCount();
	const currentLine = position.lineNumber;

	const prefixStartLine = Math.max(1, currentLine - PREFIX_LINES);
	const prefixLines: string[] = [];
	for (let i = prefixStartLine; i < currentLine; i++) {
		prefixLines.push(model.getLineContent(i));
	}
	prefixLines.push(model.getLineContent(currentLine).substring(0, position.column - 1));
	const prefix = prefixLines.join('\n');

	const suffixEndLine = Math.min(lineCount, currentLine + SUFFIX_LINES);
	const suffixLines: string[] = [];
	suffixLines.push(model.getLineContent(currentLine).substring(position.column - 1));
	for (let i = currentLine + 1; i <= suffixEndLine; i++) {
		suffixLines.push(model.getLineContent(i));
	}
	const suffix = suffixLines.join('\n');

	const language = model.getLanguageId();

	return {
		fileUri: model.uri.toString(),
		position: { line: position.lineNumber, column: position.column },
		prefix,
		suffix,
		language,
	};
}
