import { createHash } from 'node:crypto';
import { cursorOAuth } from '@cursor/auth';
import { discoverCursorModels } from '@cursor/catalog';
import type { CursorMachineIdentity } from '@cursor/identity';
import { streamCursor } from '@cursor/stream';
import { CursorInferenceRuntime } from '@cursor/transport';
import type {
	Context,
	Credential,
	Model,
	Provider,
	RefreshModelsContext,
	SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { createProvider } from '@earendil-works/pi-ai';

const providerId = 'cursor';
const backendUrl = 'https://api2.cursor.sh';
const tokenEnvironmentVariable = 'PI_CURSOR_TOKEN';

interface RuntimeSlot {
	readonly digest: string;
	readonly runtime: CursorInferenceRuntime;
}

function credentialToken(credential: Credential | undefined): string | undefined {
	if (credential?.type === 'oauth') return credential.access;
	if (credential?.type === 'api_key') return credential.key;
	return process.env[tokenEnvironmentVariable];
}

function tokenDigest(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface CursorProviderRuntime {
	readonly provider: Provider<'cursor-inference'>;
	shutdown(): Promise<void>;
}

interface CursorProviderDependencies {
	readonly discoverModels: typeof discoverCursorModels;
}

const dependencies: CursorProviderDependencies = { discoverModels: discoverCursorModels };

export function createCursorProvider(
	identity: CursorMachineIdentity,
	deps: CursorProviderDependencies = dependencies,
): CursorProviderRuntime {
	let slot: RuntimeSlot | undefined;
	let models: readonly Model<'cursor-inference'>[] = [];
	const runtimeFor = async (token: string): Promise<CursorInferenceRuntime> => {
		const digest = tokenDigest(token);
		if (slot?.digest === digest) return slot.runtime;
		await slot?.runtime.shutdown();
		const runtime = new CursorInferenceRuntime({
			backendUrl,
			token,
			ghostMode: false,
			identity,
		});
		slot = { digest, runtime };
		return runtime;
	};
	const run = (model: Model<'cursor-inference'>, context: Context, options?: SimpleStreamOptions) =>
		streamCursor(model, context, { runtime: runtimeFor }, options);
	const refreshModels = async (context: RefreshModelsContext): Promise<void> => {
		if (!context.allowNetwork || context.signal.aborted) return;
		const token = credentialToken(context.credential);
		if (token === undefined || token === '') throw new Error('Cursor credential is unavailable');
		try {
			const refreshed = await deps.discoverModels({
				backendUrl,
				token,
				signal: context.signal,
				...(context.force === undefined ? {} : { force: context.force }),
			});
			if (context.signal.aborted) return;
			await context.publish({
				persist: { models: refreshed, checkedAt: Date.now() },
				update: () => {
					models = refreshed;
				},
			});
		} catch (error) {
			if (!context.signal.aborted) {
				await context.publish({
					persist: null,
					update: () => {
						models = [];
					},
				});
			}
			throw error;
		}
	};

	const provider = createProvider<'cursor-inference'>({
		id: providerId,
		name: 'Cursor',
		baseUrl: backendUrl,
		auth: {
			apiKey: {
				name: tokenEnvironmentVariable,
				check: async ({ ctx, signal }) => {
					signal.throwIfAborted();
					return (await ctx.env(tokenEnvironmentVariable)) === undefined
						? undefined
						: { type: 'api_key', source: tokenEnvironmentVariable };
				},
				resolve: async ({ ctx, credential, signal }) => {
					signal.throwIfAborted();
					const token = credential?.key ?? (await ctx.env(tokenEnvironmentVariable));
					return token === undefined || token === ''
						? undefined
						: { auth: { apiKey: token }, source: tokenEnvironmentVariable };
				},
			},
			oauth: cursorOAuth(),
		},
		models: [],
		api: { stream: run, streamSimple: run },
	});

	return {
		provider: { ...provider, getModels: () => models, refreshModels },
		shutdown: async () => {
			await slot?.runtime.shutdown();
			slot = undefined;
		},
	};
}
