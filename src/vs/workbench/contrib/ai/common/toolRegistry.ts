/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ITool } from '../../../../platform/ai/common/aiService.js';
import { XuanjiChatMode } from '../../../../platform/ai/common/aiSettings.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IAgentFileReviewHandler } from './agentReview.js';

export const IToolRegistry = createDecorator<IToolRegistry>('xuanjiToolRegistry');

export interface IToolInvocationResult {
	readonly content: string;
	readonly isError?: boolean;
}

export interface IToolProgressUpdate {
	readonly content: string;
	readonly isError?: boolean;
}

export interface IToolExecutionContext {
	readonly mode?: XuanjiChatMode;
	readonly reviewHandler?: IAgentFileReviewHandler;
	reportProgress(update: IToolProgressUpdate): void;
}

export interface IXuanjiTool extends ITool {
	readonly modelIds?: readonly string[];
	readonly requiresConfirmation?: boolean;
	execute(input: unknown, token: CancellationToken, context?: IToolExecutionContext): Promise<IToolInvocationResult>;
}

export interface IToolRegistry {
	readonly _serviceBrand: undefined;
	readonly onDidChangeTools: Event<void>;

	registerTool(tool: IXuanjiTool): IDisposable;
	unregisterTool(name: string): void;
	getTool(name: string): IXuanjiTool | undefined;
	listTools(): readonly IXuanjiTool[];
	listModelTools(modelId?: string): readonly ITool[];
	invokeTool(name: string, input: unknown, token: CancellationToken, context?: IToolExecutionContext): Promise<IToolInvocationResult>;
}

export class ToolRegistry extends Disposable implements IToolRegistry {
	declare readonly _serviceBrand: undefined;

	private readonly _tools = new Map<string, IXuanjiTool>();

	private readonly _onDidChangeTools = this._register(new Emitter<void>());
	readonly onDidChangeTools: Event<void> = this._onDidChangeTools.event;

	registerTool(tool: IXuanjiTool): IDisposable {
		if (this._tools.has(tool.name)) {
			throw new Error(`Tool "${tool.name}" is already registered.`);
		}

		this._tools.set(tool.name, tool);
		this._onDidChangeTools.fire();

		return toDisposable(() => {
			if (this._tools.get(tool.name) === tool) {
				this.unregisterTool(tool.name);
			}
		});
	}

	unregisterTool(name: string): void {
		if (!this._tools.delete(name)) {
			return;
		}

		this._onDidChangeTools.fire();
	}

	getTool(name: string): IXuanjiTool | undefined {
		return this._tools.get(name);
	}

	listTools(): readonly IXuanjiTool[] {
		return [...this._tools.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	listModelTools(modelId?: string): readonly ITool[] {
		return this.listTools()
			.filter(tool => !tool.modelIds?.length || !modelId || tool.modelIds.includes(modelId))
			.map(tool => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			}));
	}

	async invokeTool(name: string, input: unknown, token: CancellationToken, context?: IToolExecutionContext): Promise<IToolInvocationResult> {
		const tool = this._tools.get(name);
		if (!tool) {
			throw new Error(`Tool "${name}" is not registered.`);
		}

		return tool.execute(input, token, context);
	}
}
