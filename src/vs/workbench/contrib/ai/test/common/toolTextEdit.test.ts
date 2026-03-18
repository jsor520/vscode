/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { applyTextEdit } from '../../common/toolTextEdit.js';

suite('toolTextEdit', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('replaces the first match by default', () => {
		assert.deepStrictEqual(
			applyTextEdit('alpha beta alpha', 'alpha', 'omega'),
			{ content: 'omega beta alpha', replacements: 1 },
		);
	});

	test('replaces all matches when requested', () => {
		assert.deepStrictEqual(
			applyTextEdit('alpha beta alpha', 'alpha', 'omega', true),
			{ content: 'omega beta omega', replacements: 2 },
		);
	});

	test('supports deleting matched text', () => {
		assert.deepStrictEqual(
			applyTextEdit('const value = 1;', ' value', ''),
			{ content: 'const = 1;', replacements: 1 },
		);
	});

	test('throws when target text is missing', () => {
		assert.throws(() => applyTextEdit('alpha beta', 'gamma', 'omega'));
	});

	test('throws when oldText is empty', () => {
		assert.throws(() => applyTextEdit('alpha beta', '', 'omega'));
	});
});
