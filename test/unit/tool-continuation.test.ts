import { expect, test } from 'bun:test';
import { create } from '@bufbuild/protobuf';
import {
	InferenceStreamResponseSchema,
	InferenceTextStreamPartSchema,
	InferenceToolCallStreamPartSchema,
	RunInferenceInvocationEndSchema,
	RunInferenceInvocationResponseSchema,
	RunInferenceServerMessageSchema,
} from '@cursor/gen/aiserver/v1/inference_pb';
import { streamCursor } from '@cursor/stream';
import type { CursorInferenceRuntime } from '@cursor/transport';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { agentLoop } from '@earendil-works/pi-agent-core';
import type { Context, Message, Model } from '@earendil-works/pi-ai';

const model: Model<'cursor-inference'> = {
	id: 'composer-2.5',
	name: 'Composer 2.5',
	provider: 'cursor',
	api: 'cursor-inference',
	baseUrl: 'https://api2.cursor.sh',
	reasoning: true,
	input: ['text'],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};

function modelMessages(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message): message is Message =>
			message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult',
	);
}

test('Pi returns an unknown-tool error to Cursor and continues the turn', async () => {
	let invocationCount = 0;
	const providerContexts: Context[] = [];
	const runtime: Pick<CursorInferenceRuntime, 'invoke'> = {
		invoke: async (_sessionId, _routeKey, _run, invocationId, _request, options) => {
			invocationCount += 1;
			const response =
				invocationCount === 1
					? create(InferenceStreamResponseSchema, {
							response: {
								case: 'toolCallPart',
								value: create(InferenceToolCallStreamPartSchema, {
									toolCallId: 'unknown-tool',
									toolName: 'Grep',
									args: '{}',
									isComplete: true,
								}),
							},
						})
					: create(InferenceStreamResponseSchema, {
							response: {
								case: 'textPart',
								value: create(InferenceTextStreamPartSchema, {
									text: 'Recovered after the unavailable tool.',
									isFinal: true,
								}),
							},
						});
			await options.onResponse(
				create(RunInferenceServerMessageSchema, {
					message: {
						case: 'invocationResponse',
						value: create(RunInferenceInvocationResponseSchema, {
							invocationId,
							response,
						}),
					},
				}),
			);
			return {
				invocationId,
				end: create(RunInferenceInvocationEndSchema, { invocationId }),
			};
		},
	};

	const context = { systemPrompt: '', messages: [], tools: [] };
	const messages = await agentLoop(
		[{ role: 'user', content: 'Use the unavailable tool', timestamp: 1 }],
		context,
		{
			model,
			apiKey: 'token',
			sessionId: 'pi-session',
			convertToLlm: modelMessages,
		},
		undefined,
		(_model, providerContext, options) => {
			providerContexts.push(providerContext);
			return streamCursor(model, providerContext, { runtime }, options);
		},
	).result();

	expect(invocationCount).toBe(2);
	expect(messages.map(({ role }) => role)).toEqual([
		'user',
		'assistant',
		'toolResult',
		'assistant',
	]);
	const toolResult = messages[2];
	if (toolResult?.role !== 'toolResult') throw new Error('Pi did not emit a tool result');
	expect(toolResult.isError).toBe(true);
	expect(toolResult.content).toContainEqual({ type: 'text', text: 'Tool Grep not found' });
	expect(providerContexts[1]?.messages.at(-1)).toEqual(toolResult);
	expect(messages[3]).toMatchObject({
		role: 'assistant',
		content: [{ type: 'text', text: 'Recovered after the unavailable tool.' }],
		stopReason: 'stop',
	});
});
