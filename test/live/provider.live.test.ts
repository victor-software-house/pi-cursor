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

describe.skipIf(skip)('Cursor managed inference live', () => {
	test('streams a bounded Composer response over the production transport', async () => {
		if (token === undefined || token === '') throw new Error('PI_CURSOR_TOKEN is required');
		const agentDir = await mkdtemp(join(tmpdir(), 'pi-cursor-live-'));
		const identity = await loadCursorMachineIdentity(agentDir);
		const runtime = new CursorInferenceRuntime({
			backendUrl: model.baseUrl,
			token,
			ghostMode: false,
			identity,
		});
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
					maxTokens: 64,
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
});
