/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage, IContextAttachment } from '../../../../platform/ai/common/aiService.js';
import { XuanjiChatMode } from '../../../../platform/ai/common/aiSettings.js';

export interface IXuanjiPlanDraft {
	readonly task: string;
	readonly attachments: readonly IContextAttachment[];
	readonly feedback: readonly string[];
	readonly plan: string;
}

const PLAN_MODE_SYSTEM_PROMPT = [
	'You are in Plan mode.',
	'Before taking any action, produce a concise execution plan in plain text only.',
	'Do not call tools, do not claim work has been executed, and stop after the plan.',
	'If something is ambiguous, list assumptions and open questions clearly.',
	'Wait for the user to approve or revise the plan before any execution begins.',
].join(' ');

const AGENT_MODE_SYSTEM_PROMPT = [
	'You are in Agent mode.',
	'Before using any tools, create an internal plan for the task and follow it step by step.',
	'Do not print the full plan unless the user explicitly asks for it.',
	'Explain what you are about to do before risky or user-visible actions.',
].join(' ');

function approvedPlanPrompt(plan: string): string {
	return [
		'The user approved the following execution plan.',
		'Follow it closely, but adapt if new information requires a better step order.',
		'If you must deviate from the plan, explain why before continuing.',
		'Approved plan:',
		plan,
	].join('\n\n');
}

function formatTaskForPlanning(draft: Pick<IXuanjiPlanDraft, 'task' | 'feedback'>): string {
	const sections = [`Task:\n${draft.task}`];
	if (draft.feedback.length) {
		sections.push(`Revision notes:\n${draft.feedback.map((item, index) => `${index + 1}. ${item}`).join('\n')}`);
	}
	return sections.join('\n\n');
}

function withAttachments(content: string, attachments: readonly IContextAttachment[]): IChatMessage {
	return {
		role: 'user',
		content,
		attachments: attachments.length ? [...attachments] : undefined,
	};
}

export class XuanjiAgentPlanner {
	createPlanningConversation(systemMessages: readonly IChatMessage[], draft: Pick<IXuanjiPlanDraft, 'task' | 'attachments' | 'feedback'>): IChatMessage[] {
		return [
			...systemMessages,
			{ role: 'system', content: PLAN_MODE_SYSTEM_PROMPT },
			withAttachments(formatTaskForPlanning(draft), draft.attachments),
		];
	}

	createExecutionConversation(systemMessages: readonly IChatMessage[], draft: IXuanjiPlanDraft): IChatMessage[] {
		return [
			...systemMessages,
			{ role: 'system', content: AGENT_MODE_SYSTEM_PROMPT },
			{ role: 'system', content: approvedPlanPrompt(draft.plan) },
			withAttachments(formatTaskForPlanning(draft), draft.attachments),
		];
	}

	applyExecutionMode(systemMessages: readonly IChatMessage[], messages: readonly IChatMessage[], mode: XuanjiChatMode): IChatMessage[] {
		if (mode === 'agent') {
			return [
				...systemMessages,
				{ role: 'system', content: AGENT_MODE_SYSTEM_PROMPT },
				...messages,
			];
		}

		return [
			...systemMessages,
			...messages,
		];
	}
}
