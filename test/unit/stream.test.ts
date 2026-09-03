import { describe, expect, test } from 'bun:test';
import { create } from '@bufbuild/protobuf';
import {
	InferenceExtendedUsageInfoSchema,
	InferenceExtraDataSchema,
	InferenceImageDescriptionSchema,
	InferenceImageDescriptionsInfoSchema,
	InferenceMessageRole,
	InferenceProviderMetadataInfoSchema,
	InferenceReasoningPartSchema,
	InferenceResponseInfoSchema,
	InferenceResponseMessageSchema,
	InferenceStreamErrorSchema,
	InferenceStreamErrorType,
	InferenceStreamResponseSchema,
	InferenceTextStreamPartSchema,
	InferenceThinkingStreamPartSchema,
	InferenceToolCallStreamPartSchema,
	RunInferenceInvocationEndSchema,
	RunInferenceInvocationResponseSchema,
	RunInferenceServerMessageSchema,
} from '@cursor/gen/aiserver/v1/inference_pb';
import { streamCursor } from '@cursor/stream';
import type { CursorInferenceRuntime } from '@cursor/transport';
import type {
	AssistantMessageEvent,
	Context,
	Model,
	SimpleStreamOptions,
} from '@earendil-works/pi-ai';

type CursorManagedRuntime = Pick<CursorInferenceRuntime, 'invoke' | 'shutdown'>;

const MODEL: Model<'cursor-inference'> = {
	id: 'composer-2.5',
	name: 'Composer 2.5',
	provider: 'cursor',
	api: 'cursor-inference',
	baseUrl: 'https://api2.cursor.sh',
	reasoning: true,
	input: ['text', 'image'],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};

const TOOL = {
	name: 'join_fragments',
	description: 'Join two fragments.',
	parameters: {
		type: 'object',
		properties: { left: { type: 'string' }, right: { type: 'string' } },
		required: ['left', 'right'],
		additionalProperties: false,
	},
} as const;

function response(
	invocationId: string,
	value: Parameters<typeof create<typeof InferenceStreamResponseSchema>>[1],
) {
	return create(RunInferenceServerMessageSchema, {
		message: {
			case: 'invocationResponse',
			value: create(RunInferenceInvocationResponseSchema, {
				invocationId,
				response: create(InferenceStreamResponseSchema, value),
			}),
		},
	});
}

function runtimeWith(
	messages: readonly ReturnType<typeof response>[],
	inspect?: (context: { readonly sessionId: string; readonly routeKey: string }) => void,
): CursorManagedRuntime {
	return {
		invoke: async (sessionId, routeKey, _run, invocationId, _request, options) => {
			inspect?.({ sessionId, routeKey });
			for (const message of messages) {
				const rewritten = create(RunInferenceServerMessageSchema, message);
				if (rewritten.message.case === 'invocationResponse') {
					rewritten.message.value.invocationId = invocationId;
					const nested = rewritten.message.value.response;
					if (nested?.response.case === 'invocationId') {
						nested.response.value.invocationId = invocationId;
					}
				}
				await options.onResponse(rewritten);
			}
			return {
				invocationId,
				end: create(RunInferenceInvocationEndSchema, { invocationId }),
			};
		},
		shutdown: async () => undefined,
	};
}

async function collect(
	context: Context,
	runtime: CursorManagedRuntime,
	options: SimpleStreamOptions = { apiKey: 'token', sessionId: 'pi-session' },
): Promise<{
	readonly events: AssistantMessageEvent[];
	readonly result: Awaited<ReturnType<ReturnType<typeof streamCursor>['result']>>;
}> {
	const stream = streamCursor(
		MODEL,
		context,
		{ runtime, createInvocationId: () => 'invocation-test' },
		options,
	);
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);
	return { events, result: await stream.result() };
}

describe('managed inference Pi stream', () => {
	test('emits genuine argument deltas and one authoritative tool call', async () => {
		const parts = [
			{ toolCallId: 'tool-1', toolName: TOOL.name, args: '', isComplete: false },
			{ toolCallId: 'tool-1', args: '{"left":"A', isComplete: false },
			{ toolCallId: 'tool-1', args: '","right":"B"}', isComplete: false },
			{
				toolCallId: 'tool-1',
				toolName: TOOL.name,
				args: '{"left":"A","right":"B"}',
				isComplete: true,
			},
		].map((part) =>
			response('ignored', {
				response: {
					case: 'toolCallPart',
					value: create(InferenceToolCallStreamPartSchema, part),
				},
			}),
		);
		const { events, result } = await collect(
			{
				messages: [{ role: 'user', content: 'join', timestamp: 1 }],
				tools: [TOOL],
			},
			runtimeWith(parts),
		);
		expect(events.filter(({ type }) => type === 'toolcall_start')).toHaveLength(1);
		expect(
			events.flatMap((event) => (event.type === 'toolcall_delta' ? [event.delta] : [])),
		).toEqual(['{"left":"A', '","right":"B"}']);
		expect(events.filter(({ type }) => type === 'toolcall_end')).toHaveLength(1);
		expect(result.stopReason).toBe('toolUse');
		expect(result.content).toEqual([
			{ type: 'toolCall', id: 'tool-1', name: TOOL.name, arguments: { left: 'A', right: 'B' } },
		]);
	});

	test('fails when final responseInfo omits a completed streamed tool', async () => {
		const complete = response('ignored', {
			response: {
				case: 'toolCallPart',
				value: create(InferenceToolCallStreamPartSchema, {
					toolCallId: 'tool-1',
					toolName: TOOL.name,
					args: '{"left":"A","right":"B"}',
					isComplete: true,
				}),
			},
		});
		const final = response('ignored', {
			response: {
				case: 'responseInfo',
				value: create(InferenceResponseInfoSchema, {
					messages: [
						create(InferenceResponseMessageSchema, {
							role: InferenceMessageRole.ASSISTANT,
							content: 'tool omitted',
						}),
					],
				}),
			},
		});
		const { result } = await collect(
			{
				messages: [{ role: 'user', content: 'join', timestamp: 1 }],
				tools: [TOOL],
			},
			runtimeWith([complete, final]),
		);
		expect(result).toMatchObject({
			stopReason: 'error',
			errorMessage: 'Cursor final response tool set disagrees with completed streamed tools',
		});
	});

	test('defaults max mode off and enables catalog-selected Max Mode and context', async () => {
		const routeKeys: string[] = [];
		await collect(
			{ messages: [{ role: 'user', content: 'normal', timestamp: 1 }] },
			runtimeWith([], ({ routeKey }) => routeKeys.push(routeKey)),
		);
		await collect(
			{ messages: [{ role: 'user', content: 'max', timestamp: 1 }] },
			runtimeWith([], ({ routeKey }) => routeKeys.push(routeKey)),
			{
				apiKey: 'token',
				sessionId: 'pi-session-max',
				samplingParams: { cursorMaxMode: true, cursorContext: '1m' },
			},
		);
		expect(routeKeys).toEqual([
			'{"modelId":"composer-2.5","maxMode":false,"parameters":[{"id":"fast","value":"false"}]}',
			'{"modelId":"composer-2.5","maxMode":true,"parameters":[{"id":"context","value":"1m"},{"id":"fast","value":"false"}]}',
		]);
	});

	test('uses final response messages and preserves signature-only reasoning and side channels', async () => {
		const { result } = await collect(
			{ messages: [{ role: 'user', content: 'reason', timestamp: 1 }] },
			runtimeWith([
				response('ignored', {
					response: {
						case: 'providerMetadata',
						value: create(InferenceProviderMetadataInfoSchema, {
							metadata: { provider: 'xai' },
						}),
					},
				}),
				response('ignored', {
					response: {
						case: 'imageDescriptions',
						value: create(InferenceImageDescriptionsInfoSchema, {
							descriptions: [
								create(InferenceImageDescriptionSchema, {
									messageIndex: 0,
									partIndex: 1,
									description: 'diagram',
								}),
							],
						}),
					},
				}),
				response('ignored', {
					response: {
						case: 'responseInfo',
						value: create(InferenceResponseInfoSchema, {
							id: 'response-1',
							model: 'cursor-grok-4.6-high',
							createdAt: 1234n,
							supportsSelfSummary: true,
							inferenceExtraData: create(InferenceExtraDataSchema, {}),
							messages: [
								create(InferenceResponseMessageSchema, {
									role: InferenceMessageRole.ASSISTANT,
									content: 'answer',
									reasoningParts: [
										create(InferenceReasoningPartSchema, {
											text: '',
											signature: 'opaque-reasoning',
											modelName: 'cursor-grok-4.6-high',
										}),
									],
								}),
							],
						}),
					},
				}),
			]),
		);
		expect(result.content).toEqual([
			{ type: 'thinking', thinking: '', thinkingSignature: 'opaque-reasoning' },
			{ type: 'text', text: 'answer' },
		]);
		expect(result).toMatchObject({
			responseId: 'response-1',
			responseModel: 'cursor-grok-4.6-high',
			timestamp: 1234,
			diagnostics: [
				{
					type: 'cursor-inference-response',
					details: {
						arms: { providerMetadata: 1, imageDescriptions: 1, responseInfo: 1 },
						providerMetadata: { provider: 'xai' },
						imageDescriptions: [{ messageIndex: 0, partIndex: 1, description: 'diagram' }],
						responseInfo: { createdAt: '1234', supportsSelfSummary: true },
					},
				},
			],
		});
	});

	test('preserves streamed thinking when final responseInfo has signature-only reasoning', async () => {
		const { result } = await collect(
			{ messages: [{ role: 'user', content: 'reason', timestamp: 1 }] },
			runtimeWith([
				response('ignored', {
					response: {
						case: 'thinkingPart',
						value: create(InferenceThinkingStreamPartSchema, {
							text: 'streamed analysis',
							isFinal: true,
						}),
					},
				}),
				response('ignored', {
					response: {
						case: 'textPart',
						value: create(InferenceTextStreamPartSchema, {
							text: 'draft answer',
							isFinal: true,
						}),
					},
				}),
				response('ignored', {
					response: {
						case: 'responseInfo',
						value: create(InferenceResponseInfoSchema, {
							messages: [
								create(InferenceResponseMessageSchema, {
									role: InferenceMessageRole.ASSISTANT,
									content: 'final answer',
									reasoningParts: [
										create(InferenceReasoningPartSchema, {
											isRedacted: true,
											redactedData: 'final-signature',
										}),
									],
								}),
							],
						}),
					},
				}),
			]),
		);
		expect(result.content).toEqual([
			{
				type: 'thinking',
				thinking: 'streamed analysis',
				thinkingSignature: 'final-signature',
				redacted: true,
			},
			{ type: 'text', text: 'final answer' },
		]);
	});

	test('keeps non-empty final reasoning authoritative over streamed thinking', async () => {
		const { result } = await collect(
			{ messages: [{ role: 'user', content: 'reason', timestamp: 1 }] },
			runtimeWith([
				response('ignored', {
					response: {
						case: 'thinkingPart',
						value: create(InferenceThinkingStreamPartSchema, {
							text: 'draft analysis',
							isFinal: true,
						}),
					},
				}),
				response('ignored', {
					response: {
						case: 'responseInfo',
						value: create(InferenceResponseInfoSchema, {
							messages: [
								create(InferenceResponseMessageSchema, {
									role: InferenceMessageRole.ASSISTANT,
									content: 'final answer',
									reasoningParts: [
										create(InferenceReasoningPartSchema, { text: 'final analysis' }),
									],
								}),
							],
						}),
					},
				}),
			]),
		);
		expect(result.content).toEqual([
			{ type: 'thinking', thinking: 'final analysis' },
			{ type: 'text', text: 'final answer' },
		]);
	});

	test('streams text and gives extended usage precedence', async () => {
		const { result } = await collect(
			{ messages: [{ role: 'user', content: 'hello', timestamp: 1 }] },
			runtimeWith([
				response('ignored', {
					response: {
						case: 'textPart',
						value: create(InferenceTextStreamPartSchema, { text: 'hello' }),
					},
				}),
				response('ignored', {
					response: {
						case: 'extendedUsage',
						value: create(InferenceExtendedUsageInfoSchema, {
							inputTokens: 10,
							outputTokens: 4,
							cacheReadTokens: 3,
							cacheWriteTokens: 2,
						}),
					},
				}),
			]),
		);
		expect(result.stopReason).toBe('stop');
		expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
		expect(result.usage).toMatchObject({
			input: 10,
			output: 4,
			cacheRead: 3,
			cacheWrite: 2,
			totalTokens: 19,
		});
	});

	test('normalizes input overflow but not other provider failures', async () => {
		const stream = streamCursor(
			MODEL,
			{ messages: [{ role: 'user', content: 'too much', timestamp: 1 }] },
			{
				runtime: runtimeWith([
					response('ignored', {
						response: {
							case: 'error',
							value: create(InferenceStreamErrorSchema, {
								message: 'prompt too large',
								errorType: InferenceStreamErrorType.INPUT_TOKEN_LIMIT,
							}),
						},
					}),
				]),
				createInvocationId: () => 'overflow',
			},
			{ apiKey: 'token', sessionId: 'pi-session' },
		);
		for await (const event of stream) {
			void event;
			// Consume the complete provider event stream before inspecting its rejection.
		}
		const result = await stream.result();
		expect(result.stopReason).toBe('error');
		expect(result.errorMessage).toBe('context_length_exceeded: prompt too large');
	});

	test('accepts a minimal empty successful response', async () => {
		const { events, result } = await collect(
			{ messages: [{ role: 'user', content: '', timestamp: 1 }] },
			runtimeWith([]),
		);
		expect(result.stopReason).toBe('stop');
		expect(result.content).toEqual([]);
		expect(events.map(({ type }) => type)).toEqual(['start', 'done']);
	});

	test('turns output limits with usable text into length', async () => {
		const { result } = await collect(
			{ messages: [{ role: 'user', content: 'long', timestamp: 1 }] },
			runtimeWith([
				response('ignored', {
					response: {
						case: 'textPart',
						value: create(InferenceTextStreamPartSchema, { text: 'partial' }),
					},
				}),
				response('ignored', {
					response: {
						case: 'error',
						value: create(InferenceStreamErrorSchema, {
							message: 'output cap',
							errorType: InferenceStreamErrorType.OUTPUT_TOKEN_LIMIT,
						}),
					},
				}),
			]),
		);
		expect(result.stopReason).toBe('length');
		expect(result.content).toEqual([{ type: 'text', text: 'partial' }]);
	});

	test('preserves two interleaved tool calls and their arguments', async () => {
		const messages = [
			{ id: 'first', left: 'A', complete: false },
			{ id: 'second', left: 'C', complete: false },
			{ id: 'first', left: 'A', complete: true },
			{ id: 'second', left: 'C', complete: true },
		].map(({ id, left, complete }) =>
			response('ignored', {
				response: {
					case: 'toolCallPart',
					value: create(InferenceToolCallStreamPartSchema, {
						toolCallId: id,
						toolName: TOOL.name,
						args: `{"left":"${left}","right":"B"}`,
						isComplete: complete,
					}),
				},
			}),
		);
		const { result } = await collect(
			{ messages: [{ role: 'user', content: 'parallel', timestamp: 1 }], tools: [TOOL] },
			runtimeWith(messages),
		);
		expect(result.stopReason).toBe('toolUse');
		expect(result.content.filter(({ type }) => type === 'toolCall')).toHaveLength(2);
	});

	test('fails malformed complete arguments before local execution', async () => {
		const stream = streamCursor(
			MODEL,
			{ messages: [{ role: 'user', content: 'bad', timestamp: 1 }], tools: [TOOL] },
			{
				runtime: runtimeWith([
					response('ignored', {
						response: {
							case: 'toolCallPart',
							value: create(InferenceToolCallStreamPartSchema, {
								toolCallId: 'bad',
								toolName: TOOL.name,
								args: '{',
								isComplete: true,
							}),
						},
					}),
				]),
				createInvocationId: () => 'bad',
			},
			{ apiKey: 'token', sessionId: 'pi-session' },
		);
		for await (const event of stream) void event;
		const result = await stream.result();
		expect(result.stopReason).toBe('error');
		expect(result.errorMessage).toContain('invalid JSON arguments');
	});

	test('fails an unadvertised tool call', async () => {
		const stream = streamCursor(
			MODEL,
			{ messages: [{ role: 'user', content: 'bad', timestamp: 1 }] },
			{
				runtime: runtimeWith([
					response('ignored', {
						response: {
							case: 'toolCallPart',
							value: create(InferenceToolCallStreamPartSchema, {
								toolCallId: 'unknown',
								toolName: 'unknown_tool',
							}),
						},
					}),
				]),
				createInvocationId: () => 'unknown',
			},
			{ apiKey: 'token', sessionId: 'pi-session' },
		);
		for await (const event of stream) void event;
		const result = await stream.result();
		expect(result.stopReason).toBe('error');
		expect(result.errorMessage).toContain("unadvertised tool 'unknown_tool'");
	});
});
