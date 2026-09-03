import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCursorMachineIdentity } from '@cursor/identity';
import { streamCursor } from '@cursor/stream';
import { CursorInferenceRuntime } from '@cursor/transport';
import type { Model } from '@earendil-works/pi-ai';

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
});
