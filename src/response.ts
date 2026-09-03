import { isDeepStrictEqual } from 'node:util';
import type { JsonObject } from '@bufbuild/protobuf';
import type {
	InferenceExtraData,
	InferenceImageDescription,
	InferenceResponseInfo,
	InferenceStreamResponse,
	InferenceToolCall,
	InferenceToolCallStreamPart,
	RunInferenceServerMessage,
} from '@cursor/gen/aiserver/v1/inference_pb';
import {
	InferenceMessageRole,
	InferenceStreamErrorType,
} from '@cursor/gen/aiserver/v1/inference_pb';
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
import { match } from 'ts-pattern';

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

function finalToolArguments(tool: InferenceToolCall): Record<string, unknown> {
	if (tool.args !== undefined) return Object.fromEntries(Object.entries(tool.args));
	if (tool.rawToolCallArgs === undefined || tool.rawToolCallArgs === '') return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(tool.rawToolCallArgs);
	} catch (error) {
		throw new Error(`Cursor final tool call '${tool.toolCallId}' has invalid raw arguments`, {
			cause: error,
		});
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Cursor final tool call '${tool.toolCallId}' arguments are not an object`);
	}
	return Object.fromEntries(Object.entries(parsed));
}

function extraData(value: InferenceExtraData): Record<string, unknown> {
	return {
		tokenLogprobs: value.tokenLogprobs.map(({ values }) => values),
		tokenIds: value.tokenIds.map(({ values }) => values.map(Number)),
		promptTokenIds: value.promptTokenIds.map(({ values }) => values.map(Number)),
		extraTokens: value.extraTokens.map(({ values }) => values.map(Number)),
		extraLogprobs: value.extraLogprobs.map(({ values }) => values),
		routingMatrix: value.routingMatrix.map(({ values }) =>
			values.map((item) => (item === '' ? null : item)),
		),
	};
}

function imageDescription(value: InferenceImageDescription): Record<string, unknown> {
	return omitUndefined({
		messageIndex: value.messageIndex,
		partIndex: value.partIndex,
		expContentIndex: value.expContentIndex,
		description: value.description,
	});
}

function responseRole(role: InferenceMessageRole): string {
	return match(role)
		.with(InferenceMessageRole.USER, () => 'user')
		.with(InferenceMessageRole.ASSISTANT, () => 'assistant')
		.with(InferenceMessageRole.TOOL, () => 'tool')
		.with(InferenceMessageRole.SYSTEM, () => 'system')
		.with(InferenceMessageRole.UNSPECIFIED, () => 'unspecified')
		.otherwise((value) => `unknown-${String(value)}`);
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
	readonly #responseKinds = new Map<InferenceStreamResponse['response']['case'], number>();
	#streamError: { readonly message: string; readonly outputLimit: boolean } | undefined;
	#finalContent: AssistantMessage['content'] | undefined;
	#providerMetadata: JsonObject | undefined;
	readonly #imageDescriptions: Record<string, unknown>[] = [];
	#responseDetails: Record<string, unknown> | undefined;

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
		const responseCase = response.response.case;
		this.#responseKinds.set(responseCase, (this.#responseKinds.get(responseCase) ?? 0) + 1);
		match(response.response)
			.with({ case: 'thinkingPart' }, ({ value }) => {
				if (value.text !== '') this.#appendThinking(value.text, value.signature);
				if (value.isFinal) this.#endThinking();
			})
			.with({ case: 'textPart' }, ({ value }) => {
				if (value.text !== '') this.#appendText(value.text);
				if (value.isFinal) this.#endText();
			})
			.with({ case: 'toolCallPart' }, ({ value }) => this.#handleTool(value))
			.with({ case: 'extendedUsage' }, ({ value }) => {
				this.#output.usage.input = value.inputTokens;
				this.#output.usage.output = value.outputTokens;
				this.#output.usage.cacheRead = value.cacheReadTokens;
				this.#output.usage.cacheWrite = value.cacheWriteTokens;
				this.#updateTotal();
			})
			.with({ case: 'usage' }, ({ value }) => {
				if (this.#responseKinds.has('extendedUsage')) return;
				this.#output.usage.input = value.promptTokens;
				this.#output.usage.output = value.completionTokens;
				this.#output.usage.cacheRead = 0;
				this.#output.usage.cacheWrite = 0;
				this.#updateTotal();
			})
			.with({ case: 'responseInfo' }, ({ value }) => {
				if (value.errorMessage !== undefined && value.errorMessage !== '') {
					this.#streamError = { message: value.errorMessage, outputLimit: false };
				}
				if (value.id !== '') this.#output.responseId = value.id;
				if (value.model !== '') this.#output.responseModel = value.model;
				const createdAt = Number(value.createdAt);
				if (Number.isSafeInteger(createdAt) && createdAt > 0) this.#output.timestamp = createdAt;
				this.#captureFinalResponse(value);
			})
			.with({ case: 'error' }, ({ value }) => {
				this.#streamError = {
					message: errorMessage(value),
					outputLimit:
						value.isOutputTokenLimitError ||
						value.errorType === InferenceStreamErrorType.OUTPUT_TOKEN_LIMIT,
				};
			})
			.with({ case: 'invocationId' }, ({ value }) => {
				if (value.invocationId !== this.#invocationId) {
					throw new Error('Cursor nested invocation identity disagrees with its outer envelope');
				}
			})
			.with({ case: 'providerMetadata' }, ({ value }) => {
				this.#providerMetadata = value.metadata;
			})
			.with({ case: 'imageDescriptions' }, ({ value }) => {
				this.#imageDescriptions.push(...value.descriptions.map(imageDescription));
			})
			.with({ case: undefined }, () => {
				throw new Error('Cursor inference response has no arm');
			})
			.exhaustive();
	}

	#captureFinalResponse(info: InferenceResponseInfo): void {
		const content: AssistantMessage['content'] = [];
		let substantive = false;
		const roleCounts: Record<string, number> = {};
		for (const message of info.messages) {
			const role = responseRole(message.role);
			roleCounts[role] = (roleCounts[role] ?? 0) + 1;
			// The IDE source treats every final-response role except TOOL as assistant.
			if (message.role === InferenceMessageRole.TOOL) continue;
			for (const part of message.reasoningParts) {
				const signature = part.isRedacted ? part.redactedData : part.signature;
				content.push(
					omitUndefined({
						type: 'thinking' as const,
						thinking: part.text,
						thinkingSignature: signature,
						redacted: part.isRedacted ? true : undefined,
					}),
				);
				if (part.text.trim() !== '') substantive = true;
			}
			if (message.content !== undefined && message.content.trim() !== '') {
				content.push({ type: 'text', text: message.content });
				substantive = true;
			}
			for (const tool of message.toolCalls) {
				if (tool.toolCallId === '' || tool.toolName === '') {
					throw new Error('Cursor final response contains an unnamed tool call');
				}
				if (!this.#advertisedTools.has(tool.toolName)) {
					throw new Error(`Cursor final response called unadvertised tool '${tool.toolName}'`);
				}
				content.push({
					type: 'toolCall',
					id: tool.toolCallId,
					name: tool.toolName,
					arguments: finalToolArguments(tool),
				});
				substantive = true;
			}
		}
		if (substantive) this.#finalContent = content;
		this.#responseDetails = omitUndefined({
			createdAt: info.createdAt.toString(),
			supportsSelfSummary: info.supportsSelfSummary,
			roleCounts,
			inferenceExtraData:
				info.inferenceExtraData === undefined ? undefined : extraData(info.inferenceExtraData),
		});
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
		if (this.#finalContent !== undefined) {
			this.#output.content.splice(0, this.#output.content.length, ...this.#finalContent);
		}
		const details: Record<string, unknown> = {
			arms: Object.fromEntries(this.#responseKinds),
		};
		if (this.#providerMetadata !== undefined) details['providerMetadata'] = this.#providerMetadata;
		if (this.#imageDescriptions.length > 0) {
			details['imageDescriptions'] = this.#imageDescriptions;
		}
		if (this.#responseDetails !== undefined) details['responseInfo'] = this.#responseDetails;
		this.#output.diagnostics = [
			...(this.#output.diagnostics ?? []),
			{
				type: 'cursor-inference-response',
				timestamp: Date.now(),
				details,
			},
		];
		if (this.#streamError !== undefined) {
			if (this.#streamError.outputLimit && this.#output.content.length > 0) {
				return { stopReason: 'length' };
			}
			return { stopReason: 'error', errorMessage: this.#streamError.message };
		}
		return {
			stopReason:
				this.#finalContent?.some(({ type }) => type === 'toolCall') === true ||
				this.#completedTools.size > 0
					? 'toolUse'
					: 'stop',
		};
	}
}
