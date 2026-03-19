/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { XuanjiAgentController } from '../../browser/agent/agentController.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';

suite('XuanjiAgentController', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createController() {
		const writes: Array<{ resource: URI; content: string }> = [];
		const openedEditors: unknown[] = [];

		const fileService = {
			createFolder: async () => undefined,
			writeFile: async (resource: URI, buffer: VSBuffer) => {
				writes.push({ resource, content: buffer.toString() });
			},
			exists: async () => true,
			resolve: async () => ({ children: [] }),
		};

		const workspaceFolder = { uri: URI.file('/workspace'), name: 'workspace' };
		const workspaceService = {
			getWorkspace: () => ({ folders: [workspaceFolder] }),
			getWorkspaceFolder: () => workspaceFolder,
		};

		const editorService = {
			openEditor: async (input: unknown) => {
				openedEditors.push(input);
				return undefined;
			},
		};

		const languageService = {
			guessLanguageIdByFilepathOrFirstLine: () => 'typescript',
		};

		const logService = {
			error: () => undefined,
		};

		const controller = store.add(new XuanjiAgentController(
			fileService as unknown as IFileService,
			workspaceService as unknown as IWorkspaceContextService,
			editorService as unknown as IEditorService,
			languageService as unknown as ILanguageService,
			logService as unknown as ILogService,
		));

		return { controller, writes, openedEditors };
	}

	test('opens a review diff and applies accepted changes to disk', async () => {
		const { controller, writes, openedEditors } = createController();
		const resource = URI.file('/workspace/src/demo.ts');
		controller.beginTask('agent', 'Update demo file');

		const reviewPromise = controller.reviewFileChange({
			id: 'review_1',
			toolName: 'edit_file',
			resource,
			originalContent: 'const answer = 1;\n',
			modifiedContent: 'const answer = 42;\n',
			label: 'src/demo.ts',
			summary: 'Replace the answer constant.',
			isNewFile: false,
		}, CancellationToken.None);
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.strictEqual(controller.state?.status, 'waiting_review');
		assert.strictEqual(controller.state?.pendingReview?.id, 'review_1');
		assert.strictEqual(openedEditors.length, 1);

		await controller.acceptPendingReview('review_1');
		const result = await reviewPromise;

		assert.strictEqual(result.isError, undefined);
		assert.strictEqual(controller.state?.pendingReview, undefined);
		assert.strictEqual(writes.some(entry => entry.resource.toString() === resource.toString() && entry.content === 'const answer = 42;\n'), true);
	});

	test('rejects a pending review without writing the target file', async () => {
		const { controller, writes } = createController();
		const resource = URI.file('/workspace/src/reject.ts');
		controller.beginTask('agent', 'Try a risky edit');

		const reviewPromise = controller.reviewFileChange({
			id: 'review_2',
			toolName: 'edit_file',
			resource,
			originalContent: 'old value\n',
			modifiedContent: 'new value\n',
			label: 'src/reject.ts',
			summary: 'Replace the value.',
			isNewFile: false,
		}, CancellationToken.None);
		await new Promise(resolve => setTimeout(resolve, 0));

		controller.rejectPendingReview('review_2');
		const result = await reviewPromise;

		assert.strictEqual(result.isError, true);
		assert.strictEqual(result.content, 'The user rejected the proposed change for src/reject.ts.');
		assert.strictEqual(writes.some(entry => entry.resource.toString() === resource.toString() && entry.content === 'new value\n'), false);
	});
});
