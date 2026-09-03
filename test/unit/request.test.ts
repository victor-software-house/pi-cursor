import { describe, expect, test } from 'bun:test';
import { toJson } from '@bufbuild/protobuf';
import {
	InferenceStreamRequestSchema,
	RunInferenceRunRequestSchema,
} from '@cursor/gen/aiserver/v1/inference_pb';
import {
	buildInferenceRequest,
	buildInferenceRunRequest,
	inferenceRoutingKey,
} from '@cursor/request';
import type { Context, Model } from '@earendil-works/pi-ai';
import { isRecord } from '@victor-software-house/pi-type-kit';

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
	maxTokens: 32_000,
};

const TOOL = {
	name: 'join_fragments',
	description: 'Join two text fragments and return the concatenated text.',
	parameters: {
		type: 'object',
		properties: {
			left: { type: 'string' },
			right: { type: 'string' },
			options: {
				type: 'object',
				properties: { separator: { type: 'string', enum: ['', '-'] } },
				additionalProperties: false,
			},
		},
		required: ['left', 'right'],
		additionalProperties: false,
	},
} as const;

function assistantContext(): Context {
	return {
		messages: [
			{ role: 'user', content: 'Join the fragments.', timestamp: 1 },
			{
				role: 'assistant',
				api: 'openai-responses',
				provider: 'openai',
				model: 'gpt',
				responseId: 'response-1',
				content: [
					{ type: 'thinking', thinking: 'Use the tool.', thinkingSignature: 'sig' },
					{ type: 'text', text: 'Calling ' },
					{ type: 'text', text: 'now.' },
					{
						type: 'toolCall',
						id: 'tool-1',
						name: TOOL.name,
						arguments: { left: 'STREAMED_CUSTOM_', right: 'TOOL_OK' },
					},
				],
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: 'toolUse',
				timestamp: 2,
			},
			{
				role: 'toolResult',
				toolCallId: 'tool-1',
				toolName: TOOL.name,
				content: [{ type: 'text', text: 'STREAMED_CUSTOM_TOOL_OK' }],
				isError: false,
				timestamp: 3,
			},
		],
		tools: [TOOL],
	};
}

describe('managed inference request', () => {
	test('projects arbitrary Pi tools and full cross-provider history', () => {
		const request = buildInferenceRequest({
			...assistantContext(),
			systemPrompt: 'Use the tool.',
		});
		const json = toJson(InferenceStreamRequestSchema, request);
		expect(json).toMatchObject({
			messages: [
				{ role: 'INFERENCE_MESSAGE_ROLE_SYSTEM', text: 'Use the tool.' },
				{ role: 'INFERENCE_MESSAGE_ROLE_USER', text: 'Join the fragments.' },
				{
					role: 'INFERENCE_MESSAGE_ROLE_ASSISTANT',
					text: 'Calling now.',
					modelProviderMessageId: 'response-1',
					toolCalls: [
						{
							toolCallId: 'tool-1',
							toolName: TOOL.name,
							args: { left: 'STREAMED_CUSTOM_', right: 'TOOL_OK' },
						},
					],
				},
				{
					role: 'INFERENCE_MESSAGE_ROLE_TOOL',
					toolContent: {
						parts: [
							{
								toolCallId: 'tool-1',
								toolName: TOOL.name,
								result: 'STREAMED_CUSTOM_TOOL_OK',
							},
						],
					},
				},
			],
			tools: [
				{
					name: TOOL.name,
					description: TOOL.description,
					parameters: { jsonSchema: TOOL.parameters },
				},
			],
		});
	});

	test('builds text-only routing on the stable Pi session identity', () => {
		const run = buildInferenceRunRequest(MODEL, assistantContext(), 'pi-session', undefined);
		const json = toJson(RunInferenceRunRequestSchema, run);
		expect(json).toMatchObject({
			conversationId: 'pi-session',
			agentMode: 'agent',
			requestedModel: {
				modelId: 'composer-2.5',
				parameters: [{ id: 'fast', value: 'false' }],
			},
			routingConversation: [
				{ role: 'RUN_INFERENCE_ROUTING_ROLE_USER', text: 'Join the fragments.' },
				{ role: 'RUN_INFERENCE_ROUTING_ROLE_ASSISTANT', text: 'Calling now.' },
			],
		});
		expect(inferenceRoutingKey(MODEL, undefined)).toBe(
			'{"modelId":"composer-2.5","maxMode":false,"parameters":[{"id":"fast","value":"false"}]}',
		);
		expect(inferenceRoutingKey(MODEL, undefined, true)).toBe(
			'{"modelId":"composer-2.5","maxMode":true,"parameters":[{"id":"fast","value":"false"}]}',
		);
	});

	test('forwards explicitly configured model request limits', () => {
		const request = buildInferenceRequest(
			{ messages: [{ role: 'user', content: 'bounded', timestamp: 1 }] },
			{
				maxTokens: 2048,
				temperature: 0.25,
				topP: 0.9,
				stopSequences: ['STOP'],
			},
		);
		expect(toJson(InferenceStreamRequestSchema, request)).toMatchObject({
			modelConfig: {
				maxTokens: 2048,
				temperature: 0.25,
				topP: 0.9,
				stopSequences: ['STOP'],
			},
		});
	});

	test('normalizes a text-only Pi user-part array to Cursor plain text', () => {
		const request = buildInferenceRequest({
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'left' },
						{ type: 'text', text: ' right' },
					],
					timestamp: 1,
				},
			],
		});
		const json = toJson(InferenceStreamRequestSchema, request);
		if (!isRecord(json)) throw new Error('inference request is malformed');
		expect(json['messages']).toEqual([
			{
				role: 'INFERENCE_MESSAGE_ROLE_USER',
				text: 'left right',
			},
		]);
	});

	test('rejects malformed schemas before transport', () => {
		expect(() =>
			buildInferenceRequest({
				messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
				tools: [{ name: 'bad', description: 'bad', parameters: 'not-an-object' }],
			}),
		).toThrow('schema must be a JSON object');
	});

	test('preserves image-bearing tool results as experimental content', () => {
		const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
		const bytes = Buffer.concat([Buffer.from(png, 'base64'), Buffer.alloc(12)]).toString('base64');
		const context: Context = {
			messages: [
				{
					role: 'toolResult',
					toolCallId: 'image-1',
					toolName: 'image_tool',
					content: [
						{ type: 'text', text: 'pixel' },
						{ type: 'image', data: bytes, mimeType: 'image/png' },
					],
					isError: false,
					timestamp: 1,
				},
			],
		};
		const json = toJson(InferenceStreamRequestSchema, buildInferenceRequest(context));
		if (!isRecord(json) || !Array.isArray(json['messages'])) throw new Error('messages missing');
		expect(JSON.stringify(json['messages'])).toContain('experimentalContent');
	});

	test('preserves ordered Unicode user text and validated images', () => {
		const png = Buffer.concat([
			Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64'),
			Buffer.alloc(12),
		]).toString('base64');
		const json = toJson(
			InferenceStreamRequestSchema,
			buildInferenceRequest({
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'text', text: 'before 𝄞' },
							{ type: 'image', data: png, mimeType: 'image/png' },
							{ type: 'text', text: 'after 😀' },
						],
						timestamp: 1,
					},
				],
			}),
		);
		expect(json).toMatchObject({
			messages: [
				{
					role: 'INFERENCE_MESSAGE_ROLE_USER',
					parts: {
						parts: [
							{ text: { text: 'before 𝄞' } },
							{ image: { data: png, mimeType: 'image/png' } },
							{ text: { text: 'after 😀' } },
						],
					},
				},
			],
		});
	});

	test('keeps parallel assistant calls even before results exist', () => {
		const base = assistantContext();
		const assistant = base.messages.find((message) => message.role === 'assistant');
		if (assistant?.role !== 'assistant') throw new Error('assistant fixture missing');
		assistant.content = [
			{ type: 'toolCall', id: 'first', name: TOOL.name, arguments: { left: 'A', right: 'B' } },
			{ type: 'toolCall', id: 'second', name: TOOL.name, arguments: { left: 'C', right: 'D' } },
		];
		const user = base.messages[0];
		if (user?.role !== 'user') throw new Error('user fixture missing');
		const request = buildInferenceRequest({
			messages: [user, assistant],
			tools: [TOOL],
		});
		const json = toJson(InferenceStreamRequestSchema, request);
		if (!isRecord(json) || !Array.isArray(json['messages'])) throw new Error('messages missing');
		expect(JSON.stringify(json['messages'])).toContain('first');
		expect(JSON.stringify(json['messages'])).toContain('second');
	});

	test('marks a correlated error result without losing its name', () => {
		const context = assistantContext();
		const result = context.messages.at(-1);
		if (result?.role !== 'toolResult') throw new Error('tool result fixture missing');
		result.isError = true;
		const json = toJson(InferenceStreamRequestSchema, buildInferenceRequest(context));
		expect(JSON.stringify(json)).toContain('"isError":true');
		expect(JSON.stringify(json)).toContain(TOOL.name);
	});
});
