/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { IChatChunk, IChatMessage, IChatOptions } from '../common/aiService.js';

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface OpenAIRequest {
	model: string;
	max_tokens: number;
	messages: OpenAIMessage[];
	stream: boolean;
	temperature?: number;
}

interface IOpenAIDelta {
	content?: string;
}

interface IOpenAIMessagePayload {
	content?: string | Array<unknown>;
}

interface IOpenAIChoice {
	message?: IOpenAIMessagePayload;
	text?: string;
	delta?: IOpenAIDelta;
	finish_reason?: string | null;
}

interface IOpenAIResponse {
	choices?: IOpenAIChoice[];
}

class AIRequestError extends Error {
	constructor(message: string, readonly statusCode?: number) {
		super(message);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function extractTextFromUnknown(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
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

function extractOpenAICompletionText(parsed: IOpenAIResponse): string {
	const choice = parsed.choices?.[0];
	if (!choice) {
		return '';
	}

	const messageContent = choice.message?.content;
	if (typeof messageContent === 'string') {
		return messageContent;
	}
	if (Array.isArray(messageContent)) {
		return messageContent.map(item => extractTextFromUnknown(item)).join('');
	}
	if (typeof choice.text === 'string') {
		return choice.text;
	}

	return '';
}

export class OpenAICompatClient {
	constructor(
		private readonly _apiKey: string | undefined,
		private readonly _baseUrl: string = 'https://api.openai.com',
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
		const apiMessages: OpenAIMessage[] = messages.map(message => {
			const content = message.attachments?.length
				? `${message.attachments.map(attachment => `<file name="${attachment.name}">\n${attachment.content}\n</file>`).join('\n')}\n\n${message.content}`
				: message.content;
			return { role: message.role, content };
		});

		const body: OpenAIRequest = {
			model: options.model || 'gpt-4o',
			max_tokens: options.maxTokens || 4096,
			messages: apiMessages,
			stream: true,
		};
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
		const body: OpenAIRequest = {
			model: options.model || 'gpt-4o',
			max_tokens: options.maxTokens || 2048,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			],
			stream: false,
		};
		if (options.temperature !== undefined) {
			body.temperature = options.temperature;
		}

		return this._requestNonStream(body, token);
	}

	private async *_requestWithRetry(
		body: OpenAIRequest,
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
		body: OpenAIRequest,
		token?: CancellationToken,
	): AsyncIterable<IChatChunk> {
		const abortController = new AbortController();
		const cancelDisposable = token?.onCancellationRequested(() => abortController.abort());

		try {
			const response = await fetch(this._buildUrl('/v1/chat/completions'), {
				method: 'POST',
				headers: this._getHeaders(),
				body: JSON.stringify(body),
				signal: abortController.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new AIRequestError(`API error (${response.status}): ${errorBody}`, response.status);
			}
			if (!response.body) {
				throw new Error('Response body stream is unavailable.');
			}

			yield* this._parseSSE(response.body, token);
		} finally {
			cancelDisposable?.dispose();
		}
	}

	private async *_parseSSE(
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
						const event = JSON.parse(data) as IOpenAIResponse;
						const content = event.choices?.[0]?.delta?.content;
						if (content) {
							yield { type: 'text', content };
						}
						if (event.choices?.[0]?.finish_reason === 'stop') {
							yield { type: 'done', content: '' };
							return;
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

	private async _requestNonStream(
		body: OpenAIRequest,
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
		body: OpenAIRequest,
		token?: CancellationToken,
	): Promise<string> {
		const abortController = new AbortController();
		const cancelDisposable = token?.onCancellationRequested(() => abortController.abort());

		try {
			const response = await fetch(this._buildUrl('/v1/chat/completions'), {
				method: 'POST',
				headers: this._getHeaders(),
				body: JSON.stringify(body),
				signal: abortController.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new AIRequestError(`API error (${response.status}): ${errorBody}`, response.status);
			}

			const parsed = JSON.parse(await response.text()) as IOpenAIResponse;
			return extractOpenAICompletionText(parsed);
		} finally {
			cancelDisposable?.dispose();
		}
	}

	private _getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this._apiKey) {
			headers.Authorization = `Bearer ${this._apiKey}`;
		}
		return headers;
	}
}