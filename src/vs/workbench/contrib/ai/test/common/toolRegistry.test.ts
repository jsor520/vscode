/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ToolRegistry } from '../../common/toolRegistry.js';

suite('ToolRegistry', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('registers tools, filters by model, and invokes implementations', async () => {
		const registry = store.add(new ToolRegistry());
		const disposable = store.add(registry.registerTool({
			name: 'read_file',
			description: 'Read a file',
			inputSchema: { type: 'object' },
			execute: async () => ({ content: 'hello' }),
		}));
		store.add(registry.registerTool({
			name: 'search_code',
			description: 'Search code',
			inputSchema: { type: 'object' },
			modelIds: ['claude-sonnet-4-6'],
			execute: async () => ({ content: 'match' }),
		}));

		assert.strictEqual(registry.getTool('read_file')?.description, 'Read a file');
		assert.deepStrictEqual(
			registry.listModelTools('gpt-4o').map(tool => tool.name),
			['read_file'],
		);
		assert.deepStrictEqual(
			registry.listModelTools('claude-sonnet-4-6').map(tool => tool.name),
			['read_file', 'search_code'],
		);
		assert.deepStrictEqual(
			await registry.invokeTool('read_file', { path: 'README.md' }, CancellationToken.None),
			{ content: 'hello' },
		);

		disposable.dispose();
		assert.strictEqual(registry.getTool('read_file'), undefined);
	});

	test('rejects duplicate registrations', () => {
		const registry = store.add(new ToolRegistry());
		store.add(registry.registerTool({
			name: 'list_directory',
			description: 'List a folder',
			inputSchema: { type: 'object' },
			execute: async () => ({ content: '' }),
		}));

		assert.throws(() => registry.registerTool({
			name: 'list_directory',
			description: 'Duplicate',
			inputSchema: { type: 'object' },
			execute: async () => ({ content: '' }),
		}));
	});
});
