import { describe, expect, test } from 'bun:test';
import { createCursorProvider } from '@cursor/provider';
import type { Model, ModelsPublication, RefreshModelsContext } from '@earendil-works/pi-ai';

const identity = {
	machineId: 'a'.repeat(64),
	macMachineId: 'b'.repeat(64),
	machineIdSource: 'host',
} as const;

const discoveredModel = {
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
} satisfies Model<'cursor-inference'>;

function refreshContext(
	publish: (publication: ModelsPublication) => Promise<boolean>,
): RefreshModelsContext {
	return {
		credential: { type: 'api_key', key: 'token' },
		allowNetwork: true,
		signal: new AbortController().signal,
		publish,
	};
}

describe('Cursor provider', () => {
	test('exposes native OAuth, headless env auth, and dynamic models', async () => {
		const runtime = createCursorProvider(identity);
		const provider = runtime.provider;
		expect(provider.id).toBe('cursor');
		expect(provider.getModels()).toEqual([]);
		expect(typeof provider.refreshModels).toBe('function');
		expect(provider.auth.oauth?.name).toBe('Cursor');

		const apiKey = provider.auth.apiKey;
		if (apiKey === undefined) throw new Error('Cursor API key auth is missing');
		const controller = new AbortController();
		const ctx = {
			env: async (name: string) => (name === 'PI_CURSOR_TOKEN' ? 'headless-token' : undefined),
			fileExists: async () => false,
		};
		expect(await apiKey.check?.({ ctx, signal: controller.signal })).toEqual({
			type: 'api_key',
			source: 'PI_CURSOR_TOKEN',
		});
		expect(await apiKey.resolve({ ctx, signal: controller.signal })).toEqual({
			auth: { apiKey: 'headless-token' },
			source: 'PI_CURSOR_TOKEN',
		});
		await runtime.shutdown();
	});

	test('clears the dynamic catalog instead of retaining stale models after failure', async () => {
		let calls = 0;
		const runtime = createCursorProvider(identity, {
			discoverModels: async () => {
				calls += 1;
				if (calls > 1) throw new Error('catalog unavailable');
				return [discoveredModel];
			},
		});
		const provider = runtime.provider;
		if (provider.refreshModels === undefined) throw new Error('Cursor model refresh is missing');
		const publications: (ModelsPublication['persist'] | undefined)[] = [];
		const context = refreshContext(async (publication) => {
			publications.push(publication.persist);
			publication.update?.();
			return true;
		});

		await provider.refreshModels(context);
		expect(provider.getModels()).toEqual([discoveredModel]);
		let failure: unknown;
		try {
			await provider.refreshModels(context);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(Error);
		if (!(failure instanceof Error)) throw new Error('Expected a catalog error');
		expect(failure.message).toBe('catalog unavailable');
		expect(provider.getModels()).toEqual([]);
		expect(publications.at(-1)).toBeNull();
		await runtime.shutdown();
	});
});
