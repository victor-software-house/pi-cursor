import { isDeepStrictEqual } from 'node:util';
import type {
	InferenceStreamResponse,
	InferenceToolCallStreamPart,
	RunInferenceServerMessage,
} from '@cursor/gen/aiserver/v1/inference_pb';
import { InferenceStreamErrorType } from '@cursor/gen/aiserver/v1/inference_pb';
import type {
	AssistantMessage,
	AssistantMessageEventStream,
	StopReason,
	TextContent,
	ThinkingContent,
	ToolCall,
} from '@earendil-works/pi-ai';
import { parseStreamingJson } from '@earendil-works/pi-ai';
import { omitUndefined } from '@victor-software-house/pi-type-kit';

interface OpenBlock<T> {
	readonly index: number;
	readonly block: T;
}

interface OpenTool extends OpenBlock<ToolCall> {
	name: string;
	json: string;
	complete: boolean;
	readonly toolIndex: number | undefined;
}

export interface InferenceMapperResult {
	readonly stopReason: StopReason;
	readonly errorMessage?: string;
}

function objectArguments(json: string, complete: boolean): Record<string, unknown> | undefined {
	if (json === '') return complete ? {} : undefined;
	let parsed: unknown;
	try {
		parsed = complete ? JSON.parse(json) : parseStreamingJson(json);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
	return Object.fromEntries(Object.entries(parsed));
}

function errorMessage(
	response: Extract<InferenceStreamResponse['response'], { case: 'error' }>['value'],
): string {
	const message =
		response.message === '' ? response.code || 'Cursor inference failed' : response.message;
	if (
		response.isInputTokenLimitError ||
		response.errorType === InferenceStreamErrorType.INPUT_TOKEN_LIMIT
	) {
		return `context_length_exceeded: ${message}`;
	}
	return message;
}

/** Maps one correlated managed invocation onto Pi's provider event contract. */
export class CursorInferenceMapper {
	readonly #stream: AssistantMessageEventStream;
	readonly #output: AssistantMessage;
	readonly #advertisedTools: ReadonlySet<string>;
	readonly #invocationId: string;
	#text: OpenBlock<TextContent> | undefined;
	#thinking: OpenBlock<ThinkingContent> | undefined;
	readonly #tools = new Map<string, OpenTool>();
	readonly #completedTools = new Set<string>();
	readonly #responseKinds = new Set<InferenceStreamResponse['response']['case']>();
	#streamError: { readonly message: string; readonly outputLimit: boolean } | undefined;

	constructor(
		stream: AssistantMessageEventStream,
		output: AssistantMessage,
		advertisedTools: ReadonlySet<string>,
		invocationId: string,
	) {
		this.#stream = stream;
		this.#output = output;
		this.#advertisedTools = advertisedTools;
		this.#invocationId = invocationId;
	}

	handle(message: RunInferenceServerMessage): void {
		if (message.message.case !== 'invocationResponse') {
			throw new Error(`Cursor mapper received outer arm '${message.message.case ?? '<unset>'}'`);
		}
		const response = message.message.value.response;
		if (response === undefined) throw new Error('Cursor invocation response has no payload');
		this.#handleResponse(response);
	}

	#handleResponse(response: InferenceStreamResponse): void {
		this.#responseKinds.add(response.response.case);
		switch (response.response.case) {
			case 'thinkingPart': {
				const part = response.response.value;
				if (part.text !== '') this.#appendThinking(part.text, part.signature);
				if (part.isFinal) this.#endThinking();
				return;
			}
			case 'textPart': {
				const part = response.response.value;
				if (part.text !== '') this.#appendText(part.text);
				if (part.isFinal) this.#endText();
				return;
			}
			case 'toolCallPart':
				this.#handleTool(response.response.value);
				return;
			case 'extendedUsage': {
				const usage = response.response.value;
				this.#output.usage.input = usage.inputTokens;
				this.#output.usage.output = usage.outputTokens;
				this.#output.usage.cacheRead = usage.cacheReadTokens;
				this.#output.usage.cacheWrite = usage.cacheWriteTokens;
				this.#updateTotal();
				return;
			}
			case 'usage': {
				if (this.#responseKinds.has('extendedUsage')) return;
				const usage = response.response.value;
				this.#output.usage.input = usage.promptTokens;
				this.#output.usage.output = usage.completionTokens;
				this.#output.usage.cacheRead = 0;
				this.#output.usage.cacheWrite = 0;
				this.#updateTotal();
				return;
			}
			case 'responseInfo': {
				const info = response.response.value;
				if (info.errorMessage !== undefined && info.errorMessage !== '') {
					this.#streamError = { message: info.errorMessage, outputLimit: false };
				}
				if (info.id !== '') this.#output.responseId = info.id;
				if (info.model !== '') this.#output.responseModel = info.model;
				return;
			}
			case 'error': {
				const error = response.response.value;
				this.#streamError = {
					message: errorMessage(error),
					outputLimit:
						error.isOutputTokenLimitError ||
						error.errorType === InferenceStreamErrorType.OUTPUT_TOKEN_LIMIT,
				};
				return;
			}
			case 'invocationId':
				if (response.response.value.invocationId !== this.#invocationId) {
					throw new Error('Cursor nested invocation identity disagrees with its outer envelope');
				}
				return;
			case 'providerMetadata':
			case 'imageDescriptions':
				return;
			case undefined:
				throw new Error('Cursor inference response has no arm');
		}
	}

	#appendThinking(delta: string, signature: string | undefined): void {
		this.#endText();
		if (this.#thinking === undefined) {
			const block: ThinkingContent = {
				type: 'thinking',
				thinking: '',
				...omitUndefined({ thinkingSignature: signature }),
			};
			this.#output.content.push(block);
			this.#thinking = { index: this.#output.content.length - 1, block };
			this.#stream.push({
				type: 'thinking_start',
				contentIndex: this.#thinking.index,
				partial: this.#output,
			});
		} else if (
			signature !== undefined &&
			this.#thinking.block.thinkingSignature !== undefined &&
			this.#thinking.block.thinkingSignature !== signature
		) {
			throw new Error('Cursor thinking signature changed within one block');
		} else if (signature !== undefined) {
			this.#thinking.block.thinkingSignature = signature;
		}
		this.#thinking.block.thinking += delta;
		this.#stream.push({
			type: 'thinking_delta',
			contentIndex: this.#thinking.index,
			delta,
			partial: this.#output,
		});
	}

	#appendText(delta: string): void {
		this.#endThinking();
		if (this.#text === undefined) {
			const block: TextContent = { type: 'text', text: '' };
			this.#output.content.push(block);
			this.#text = { index: this.#output.content.length - 1, block };
			this.#stream.push({
				type: 'text_start',
				contentIndex: this.#text.index,
				partial: this.#output,
			});
		}
		this.#text.block.text += delta;
		this.#stream.push({
			type: 'text_delta',
			contentIndex: this.#text.index,
			delta,
			partial: this.#output,
		});
	}

	#handleTool(part: InferenceToolCallStreamPart): void {
		if (part.toolCallId === '') throw new Error('Cursor tool call has no id');
		if (this.#completedTools.has(part.toolCallId)) {
			throw new Error(`Cursor tool call '${part.toolCallId}' continued after completion`);
		}
		let open = this.#tools.get(part.toolCallId);
		if (open === undefined) {
			if (part.toolName === '') throw new Error('Cursor tool call starts without a name');
			if (!this.#advertisedTools.has(part.toolName)) {
				throw new Error(`Cursor called unadvertised tool '${part.toolName}'`);
			}
			this.#endText();
			this.#endThinking();
			const block: ToolCall = {
				type: 'toolCall',
				id: part.toolCallId,
				name: part.toolName,
				arguments: {},
			};
			this.#output.content.push(block);
			open = {
				index: this.#output.content.length - 1,
				block,
				name: part.toolName,
				json: '',
				complete: false,
				toolIndex: part.toolIndex,
			};
			this.#tools.set(part.toolCallId, open);
			this.#stream.push({
				type: 'toolcall_start',
				contentIndex: open.index,
				partial: this.#output,
			});
		}
		if (part.toolName !== '' && part.toolName !== open.name) {
			throw new Error(`Cursor tool call '${part.toolCallId}' changed name`);
		}
		if (!part.isComplete) {
			if (part.args === '') return;
			open.json += part.args;
			const partial = objectArguments(open.json, false);
			if (partial !== undefined) open.block.arguments = partial;
			this.#stream.push({
				type: 'toolcall_delta',
				contentIndex: open.index,
				delta: part.args,
				partial: this.#output,
			});
			return;
		}
		const complete = objectArguments(part.args, true);
		if (complete === undefined) {
			throw new Error(
				`Cursor tool call '${part.toolCallId}' completed with invalid JSON arguments`,
			);
		}
		const streamed = objectArguments(open.json, true);
		if (open.json !== '' && (streamed === undefined || !isDeepStrictEqual(streamed, complete))) {
			throw new Error(
				`Cursor tool call '${part.toolCallId}' argument stream disagrees with completion`,
			);
		}
		open.block.arguments = complete;
		open.complete = true;
		this.#stream.push({
			type: 'toolcall_end',
			contentIndex: open.index,
			toolCall: open.block,
			partial: this.#output,
		});
		this.#tools.delete(part.toolCallId);
		this.#completedTools.add(part.toolCallId);
	}

	#updateTotal(): void {
		this.#output.usage.totalTokens =
			this.#output.usage.input +
			this.#output.usage.output +
			this.#output.usage.cacheRead +
			this.#output.usage.cacheWrite;
	}

	#endText(): void {
		if (this.#text === undefined) return;
		this.#stream.push({
			type: 'text_end',
			contentIndex: this.#text.index,
			content: this.#text.block.text,
			partial: this.#output,
		});
		this.#text = undefined;
	}

	#endThinking(): void {
		if (this.#thinking === undefined) return;
		this.#stream.push({
			type: 'thinking_end',
			contentIndex: this.#thinking.index,
			content: this.#thinking.block.thinking,
			partial: this.#output,
		});
		this.#thinking = undefined;
	}

	finish(): InferenceMapperResult {
		this.#endText();
		this.#endThinking();
		if (this.#tools.size > 0) {
			throw new Error('Cursor invocation ended with incomplete tool calls');
		}
		if (this.#streamError !== undefined) {
			if (this.#streamError.outputLimit && this.#output.content.length > 0) {
				return { stopReason: 'length' };
			}
			return { stopReason: 'error', errorMessage: this.#streamError.message };
		}
		return { stopReason: this.#completedTools.size > 0 ? 'toolUse' : 'stop' };
	}
}
