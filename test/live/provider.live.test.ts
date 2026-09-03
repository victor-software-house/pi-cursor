import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCursorMachineIdentity } from '@cursor/identity';
import { streamCursor } from '@cursor/stream';
import { CursorInferenceRuntime } from '@cursor/transport';
import type { AssistantMessage, Context, Model } from '@earendil-works/pi-ai';
import { isRecord } from '@victor-software-house/pi-type-kit';

const token = process.env['PI_CURSOR_TOKEN'];
const skip = process.env['CI'] !== undefined || token === undefined || token === '';

const model: Model<'cursor-inference'> = {
	id: 'composer-2.5',
	name: 'Composer 2.5',
	provider: 'cursor',
	api: 'cursor-inference',
	baseUrl: 'https://api2.cursor.sh',
	reasoning: false,
	input: ['text', 'image'],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};

const defaultModel: Model<'cursor-inference'> = {
	...model,
	id: 'default',
	name: 'Auto',
};

const tool = {
	name: 'join_fragments',
	description: 'Join two text fragments and return the exact result.',
	parameters: {
		type: 'object',
		properties: { left: { type: 'string' }, right: { type: 'string' } },
		required: ['left', 'right'],
		additionalProperties: false,
	},
} as const;

function expectReconciliation(message: AssistantMessage, toolStatus: 'none' | 'exact'): void {
	const diagnostic = message.diagnostics?.find(
		(candidate) => candidate.type === 'cursor-inference-response',
	);
	const details = diagnostic?.details;
	if (!isRecord(details) || !isRecord(details['reconciliation'])) {
		throw new Error('Cursor live response has no reconciliation diagnostic');
	}
	const reconciliation = details['reconciliation'];
	const text = reconciliation['text'];
	const reasoning = reconciliation['reasoning'];
	const tools = reconciliation['tools'];
	if (!isRecord(text) || !isRecord(reasoning) || !isRecord(tools)) {
		throw new Error('Cursor live reconciliation diagnostic is malformed');
	}
	expect(reconciliation['responseInfo']).toBe(true);
	expect(typeof text['streamedBlocks']).toBe('number');
	expect(typeof text['finalBlocks']).toBe('number');
	expect(text['exact'] === true || text['exact'] === false || text['exact'] === null).toBe(true);
	expect(typeof reasoning['streamedBlocks']).toBe('number');
	expect(typeof reasoning['finalBlocks']).toBe('number');
	expect(typeof reasoning['mergedMetadata']).toBe('number');
	expect(typeof reasoning['unmatchedMetadata']).toBe('number');
	expect(tools['status']).toBe(toolStatus);
}

async function liveRuntime(accessToken: string): Promise<{
	readonly runtime: CursorInferenceRuntime;
	readonly agentDir: string;
}> {
	const agentDir = await mkdtemp(join(tmpdir(), 'pi-cursor-live-'));
	const identity = await loadCursorMachineIdentity(agentDir);
	return {
		agentDir,
		runtime: new CursorInferenceRuntime({
			backendUrl: model.baseUrl,
			token: accessToken,
			ghostMode: false,
			identity,
		}),
	};
}

describe.skipIf(skip)('Cursor managed inference live', () => {
	test('streams a bounded Composer response over the production transport', async () => {
		if (token === undefined || token === '') throw new Error('PI_CURSOR_TOKEN is required');
		const { agentDir, runtime } = await liveRuntime(token);
		try {
			const stream = streamCursor(
				model,
				{
					messages: [
						{
							role: 'user',
							content: 'Reply with the single word READY.',
							timestamp: Date.now(),
						},
					],
				},
				{ runtime },
				{
					apiKey: token,
					sessionId: `pi-cursor-live-${crypto.randomUUID()}`,
					maxTokens: 256,
				},
			);
			const eventTypes: string[] = [];
			for await (const event of stream) eventTypes.push(event.type);
			const result = await stream.result();
			expectReconciliation(result, 'none');
			expect(eventTypes[0]).toBe('start');
			expect(result.stopReason).not.toBe('error');
			expect(
				result.content.some((block) => block.type === 'text' && block.text.trim().length > 0),
			).toBe(true);
		} finally {
			await runtime.shutdown();
			await rm(agentDir, { recursive: true, force: true });
		}
	}, 120_000);

	test('keeps routed default thinking in the finalized message', async () => {
		if (token === undefined || token === '') throw new Error('PI_CURSOR_TOKEN is required');
		const { agentDir, runtime } = await liveRuntime(token);
		try {
			const stream = streamCursor(
				defaultModel,
				{
					messages: [
						{
							role: 'user',
							content:
								'Analyze whether every integer whose square is divisible by 12 must itself be divisible by 6. Explain briefly.',
							timestamp: Date.now(),
						},
					],
				},
				{ runtime },
				{
					apiKey: token,
					sessionId: `pi-cursor-default-live-${crypto.randomUUID()}`,
					maxTokens: 1_024,
				},
			);
			let streamedThinking = '';
			for await (const event of stream) {
				if (event.type === 'thinking_delta') streamedThinking += event.delta;
			}
			const result = await stream.result();
			expectReconciliation(result, 'none');
			const finalThinking = result.content
				.filter((block) => block.type === 'thinking')
				.map((block) => block.thinking)
				.join('');
			expect(streamedThinking.trim().length).toBeGreaterThan(0);
			expect(finalThinking).toContain(streamedThinking);
		} finally {
			await runtime.shutdown();
			await rm(agentDir, { recursive: true, force: true });
		}
	}, 120_000);

	test('matches completed streamed and final tools before continuing', async () => {
		if (token === undefined || token === '') throw new Error('PI_CURSOR_TOKEN is required');
		const { agentDir, runtime } = await liveRuntime(token);
		const sessionId = `pi-cursor-tool-live-${crypto.randomUUID()}`;
		const prompt =
			'Call join_fragments with left exactly "STREAMED_CUSTOM_" and right exactly "TOOL_OK". After the tool result, reply with exactly that result.';
		try {
			const first = streamCursor(
				model,
				{ messages: [{ role: 'user', content: prompt, timestamp: Date.now() }], tools: [tool] },
				{ runtime },
				{ apiKey: token, sessionId, maxTokens: 512 },
			);
			let argumentDeltas = 0;
			for await (const event of first) {
				if (event.type === 'toolcall_delta') argumentDeltas += 1;
			}
			const toolMessage = await first.result();
			expectReconciliation(toolMessage, 'exact');
			expect(toolMessage.stopReason).toBe('toolUse');
			const calls = toolMessage.content.filter((block) => block.type === 'toolCall');
			expect(calls).toHaveLength(1);
			expect(calls[0]?.name).toBe(tool.name);
			expect(calls[0]?.arguments).toEqual({
				left: 'STREAMED_CUSTOM_',
				right: 'TOOL_OK',
			});
			expect(argumentDeltas).toBeGreaterThan(0);
			const call = calls[0];
			if (call === undefined) throw new Error('Cursor live tool call is missing');

			const context: Context = {
				messages: [
					{ role: 'user', content: prompt, timestamp: toolMessage.timestamp - 1 },
					toolMessage,
					{
						role: 'toolResult',
						toolCallId: call.id,
						toolName: call.name,
						content: [{ type: 'text', text: 'STREAMED_CUSTOM_TOOL_OK' }],
						isError: false,
						timestamp: Date.now(),
					},
				],
				tools: [tool],
			};
			const continuation = streamCursor(
				model,
				context,
				{ runtime },
				{ apiKey: token, sessionId, maxTokens: 256 },
			);
			let continuationEvents = 0;
			for await (const event of continuation) {
				if (event.type === 'start') continuationEvents += 1;
			}
			const final = await continuation.result();
			expect(continuationEvents).toBe(1);
			expectReconciliation(final, 'none');
			expect(
				final.content.some(
					(block) => block.type === 'text' && block.text.includes('STREAMED_CUSTOM_TOOL_OK'),
				),
			).toBe(true);
		} finally {
			await runtime.shutdown();
			await rm(agentDir, { recursive: true, force: true });
		}
	}, 180_000);
});
