/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { IChatChunk, IChatMessage, IChatOptions } from '../common/aiService.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

type AnthropicRole = 'user' | 'assistant';

interface ITextBlock {
	type: 'text';
	text: string;
}

interface AnthropicMessage {
	role: AnthropicRole;
	content: string;
}

interface AnthropicRequest {
	model: string;
	max_tokens: number;
	system?: ITextBlock[];
	messages: AnthropicMessage[];
	stream: boolean;
	temperature?: number;
}

interface IAnthropicDeltaEvent {
	type?: string;
	text?: string;
	thinking?: string;
}

interface IAnthropicErrorEvent {
	message?: string;
}

interface IAnthropicEvent {
	type?: string;
	delta?: IAnthropicDeltaEvent;
	error?: IAnthropicErrorEvent;
}

interface IAnthropicCompletionResponse {
	content?: unknown;
}

class AIRequestError extends Error {
	constructor(message: string, readonly statusCode?: number) {
		super(message);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function toSystemFormat(value: string): ITextBlock[] {
	return [{ type: 'text', text: value }];
}

function extractTextCandidate(value: unknown): string {
	if (!isRecord(value)) {
		return '';
	}

	if (value.type === 'text' && typeof value.text === 'string') {
		return value.text;
	}

	for (const nestedValue of Object.values(value)) {
		if (isRecord(nestedValue) && nestedValue.type === 'text' && typeof nestedValue.text === 'string') {
			return nestedValue.text;
		}
	}

	return '';
}

function extractTextFromContent(content: unknown): string {
	if (!Array.isArray(content)) {
		return '';
	}

	return content.map(item => extractTextCandidate(item)).join('');
}

export class AnthropicClient {
	constructor(
		private readonly _apiKey: string | undefined,
		private readonly _baseUrl: string = 'https://api.anthropic.com',
	) { }

	private _buildUrl(path: string): string {
		const base = this._baseUrl.replace(/\/+$/, '');
		return `${base}${path}`;
	}

	async *chatStream(
		messages: IChatMessage[],
		options: IChatOptions,
		token?: CancellationToken,
	): AsyncIterable<IChatChunk> {
		let systemPrompt: string | undefined;
		const apiMessages: AnthropicMessage[] = [];

		for (const message of messages) {
			if (message.role === 'system') {
				systemPrompt = systemPrompt ? `${systemPrompt}\n\n${message.content}` : message.content;
				continue;
			}

			const content = message.attachments?.length
				? `${message.attachments.map(attachment => `<file name="${attachment.name}">\n${attachment.content}\n</file>`).join('\n')}\n\n${message.content}`
				: message.content;
			apiMessages.push({ role: message.role, content });
		}

		const body: AnthropicRequest = {
			model: options.model || 'claude-sonnet-4-6',
			max_tokens: options.maxTokens || 4096,
			messages: apiMessages,
			stream: true,
		};

		if (systemPrompt) {
			body.system = toSystemFormat(systemPrompt);
		}
		if (options.temperature !== undefined) {
			body.temperature = options.temperature;
		}

		yield* this._requestWithRetry(body, token);
	}

	async complete(
		systemPrompt: string,
		userPrompt: string,
		options: IChatOptions,
		token?: CancellationToken,
	): Promise<string> {
		const body: AnthropicRequest = {
			model: options.model || 'claude-sonnet-4-6',
			max_tokens: options.maxTokens || 2048,
			system: toSystemFormat(systemPrompt),
			messages: [{ role: 'user', content: userPrompt }],
			stream: false,
		};

		if (options.temperature !== undefined) {
			body.temperature = options.temperature;
		}

		return this._requestNonStream(body, token);
	}

	private async *_requestWithRetry(
		body: AnthropicRequest,
		token?: CancellationToken,
	): AsyncIterable<IChatChunk> {
		let lastError: Error | undefined;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			if (token?.isCancellationRequested) {
				yield { type: 'error', content: 'Request cancelled.' };
				return;
			}

			try {
				yield* this._streamRequest(body, token);
				return;
			} catch (error) {
				if (error instanceof Error) {
					lastError = error;
				}
				if (error instanceof AIRequestError && error.statusCode === 429 && attempt < MAX_RETRIES - 1) {
					const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				}

				yield { type: 'error', content: error instanceof Error ? error.message : String(error) };
				return;
			}
		}

		yield { type: 'error', content: lastError?.message || 'Request failed.' };
	}

	private async *_streamRequest(
		body: AnthropicRequest,
		token?: CancellationToken,
	): AsyncIterable<IChatChunk> {
		const abortController = new AbortController();
		const cancelDisposable = token?.onCancellationRequested(() => abortController.abort());

		try {
			const response = await fetch(this._buildUrl('/v1/messages'), {
				method: 'POST',
				headers: this._getHeaders(),
				body: JSON.stringify(body),
				signal: abortController.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new AIRequestError(`Anthropic API error (${response.status}): ${errorBody}`, response.status);
			}
			if (!response.body) {
				throw new Error('Response body stream is unavailable.');
			}

			yield* this._parseSSEFromReadableStream(response.body, token);
		} finally {
			cancelDisposable?.dispose();
		}
	}

	private async *_parseSSEFromReadableStream(
		body: ReadableStream<Uint8Array>,
		token?: CancellationToken,
	): AsyncIterable<IChatChunk> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				if (token?.isCancellationRequested) {
					void reader.cancel();
					yield { type: 'error', content: 'Request cancelled.' };
					return;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) {
						continue;
					}

					const data = line.slice(6).trim();
					if (data === '[DONE]') {
						yield { type: 'done', content: '' };
						return;
					}

					try {
						const event = JSON.parse(data) as unknown;
						const parsed = this._parseEvent(event);
						if (parsed) {
							yield parsed;
						}
					} catch {
						// Ignore malformed SSE payloads and continue.
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		yield { type: 'done', content: '' };
	}

	private _parseEvent(event: unknown): IChatChunk | undefined {
		if (!isRecord(event)) {
			return undefined;
		}

		const parsedEvent = event as IAnthropicEvent;
		switch (parsedEvent.type) {
			case 'content_block_delta': {
				const delta = parsedEvent.delta;
				if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
					return { type: 'text', content: delta.text };
				}
				if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
					return { type: 'thinking', content: delta.thinking };
				}
				return undefined;
			}
			case 'message_stop':
				return { type: 'done', content: '' };
			case 'error':
				return { type: 'error', content: parsedEvent.error?.message || 'Unknown error.' };
			default:
				return undefined;
		}
	}

	private async _requestNonStream(
		body: AnthropicRequest,
		token?: CancellationToken,
	): Promise<string> {
		body.stream = false;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			if (token?.isCancellationRequested) {
				throw new Error('Request cancelled.');
			}

			try {
				return await this._doNonStreamRequest(body, token);
			} catch (error) {
				if (error instanceof AIRequestError && error.statusCode === 429 && attempt < MAX_RETRIES - 1) {
					const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				}
				throw error;
			}
		}

		throw new Error('Request failed after the maximum number of retries.');
	}

	private async _doNonStreamRequest(
		body: AnthropicRequest,
		token?: CancellationToken,
	): Promise<string> {
		const abortController = new AbortController();
		const cancelDisposable = token?.onCancellationRequested(() => abortController.abort());

		try {
			const response = await fetch(this._buildUrl('/v1/messages'), {
				method: 'POST',
				headers: this._getHeaders(),
				body: JSON.stringify(body),
				signal: abortController.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new AIRequestError(`Anthropic API error (${response.status}): ${errorBody}`, response.status);
			}

			const parsed = JSON.parse(await response.text()) as IAnthropicCompletionResponse;
			return extractTextFromContent(parsed.content);
		} finally {
			cancelDisposable?.dispose();
		}
	}

	private _getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json; charset=utf-8',
			'anthropic-version': ANTHROPIC_API_VERSION,
		};
		if (this._apiKey) {
			headers['x-api-key'] = this._apiKey;
		}
		return headers;
	}
}