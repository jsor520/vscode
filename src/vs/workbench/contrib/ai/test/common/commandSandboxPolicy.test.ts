/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { assessCommandPolicy, DEFAULT_ALLOWED_COMMANDS, DEFAULT_BLOCKED_PATTERNS, DEFAULT_COMMAND_TIMEOUT_MS, matchesCommandPrefix, normalizeCommand } from '../../common/commandSandboxPolicy.js';

suite('commandSandboxPolicy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('normalizes whitespace before evaluation', () => {
		assert.strictEqual(normalizeCommand('  git   status  '), 'git status');
	});

	test('matches allowed command prefixes on word boundaries', () => {
		assert.strictEqual(matchesCommandPrefix('git status --short', 'git status'), true);
		assert.strictEqual(matchesCommandPrefix('git statusz', 'git status'), false);
	});

	test('allows allowlisted commands in standard mode', () => {
		const assessment = assessCommandPolicy('git status --short', {
			mode: 'standard',
			allowedCommands: DEFAULT_ALLOWED_COMMANDS,
			blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
			timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		});

		assert.strictEqual(assessment.requiresConfirmation, false);
		assert.strictEqual(assessment.reason, 'allowed');
		assert.strictEqual(assessment.matchedAllowedCommand, 'git status');
	});

	test('requires confirmation for unlisted commands in standard mode', () => {
		const assessment = assessCommandPolicy('git push origin main', {
			mode: 'standard',
			allowedCommands: DEFAULT_ALLOWED_COMMANDS,
			blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
			timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		});

		assert.strictEqual(assessment.requiresConfirmation, true);
		assert.strictEqual(assessment.reason, 'unlisted');
	});

	test('requires confirmation when blocked patterns match', () => {
		const assessment = assessCommandPolicy('git push --force origin main', {
			mode: 'standard',
			allowedCommands: DEFAULT_ALLOWED_COMMANDS,
			blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
			timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		});

		assert.strictEqual(assessment.requiresConfirmation, true);
		assert.strictEqual(assessment.reason, 'blocked-pattern');
		assert.strictEqual(assessment.matchedBlockedPattern, 'git push --force');
	});

	test('strict mode always requires confirmation', () => {
		const assessment = assessCommandPolicy('pwd', {
			mode: 'strict',
			allowedCommands: DEFAULT_ALLOWED_COMMANDS,
			blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
			timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		});

		assert.strictEqual(assessment.requiresConfirmation, true);
		assert.strictEqual(assessment.reason, 'strict');
	});

	test('yolo mode skips confirmation even for blocked commands', () => {
		const assessment = assessCommandPolicy('rm -rf /tmp/demo', {
			mode: 'yolo',
			allowedCommands: DEFAULT_ALLOWED_COMMANDS,
			blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
			timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		});

		assert.strictEqual(assessment.requiresConfirmation, false);
		assert.strictEqual(assessment.reason, 'yolo');
		assert.strictEqual(assessment.matchedBlockedPattern, 'rm -rf');
	});
});
