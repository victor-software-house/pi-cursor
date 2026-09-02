import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { isRecord } from '@victor-software-house/pi-type-kit';

const loginUrl = 'https://cursor.com/loginDeepControl';
const pollUrl = 'https://api2.cursor.sh/auth/poll';
const refreshUrl = 'https://api2.cursor.sh/auth/exchange_user_api_key';
const apiKeyEnvironmentVariable = 'PI_CURSOR_API_KEY';
const maxPollAttempts = 150;
const maxConsecutiveErrors = 3;
const basePollDelayMs = 1_000;
const maxPollDelayMs = 10_000;
const backoffMultiplier = 1.2;
const expirySkewMs = 5 * 60 * 1_000;

export interface CursorAuthRequest {
	readonly verifier: string;
	readonly challenge: string;
	readonly uuid: string;
	readonly url: string;
}

export type CursorFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CursorAuthDependencies {
	readonly fetch: CursorFetch;
	readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly randomBytes: (size: number) => Uint8Array;
	readonly randomUuid: () => string;
}

const dependencies: CursorAuthDependencies = {
	fetch,
	sleep: async (milliseconds, signal) => {
		await delay(milliseconds, undefined, { signal });
	},
	randomBytes,
	randomUuid: randomUUID,
};

function base64Url(value: Uint8Array): string {
	return Buffer.from(value).toString('base64url');
}

export function createCursorAuthRequest(
	deps: Pick<CursorAuthDependencies, 'randomBytes' | 'randomUuid'> = dependencies,
): CursorAuthRequest {
	const verifierBytes = deps.randomBytes(32);
	if (verifierBytes.byteLength !== 32) throw new Error('Cursor login verifier must be 32 bytes');
	const verifier = base64Url(verifierBytes);
	// Proven against the captured 2026-08-25 login and the extracted CLI/IDE/SDK auth clients:
	// the challenge hashes the base64url verifier STRING, never the raw bytes. Hashing raw
	// bytes yields a challenge the server never accepts and the poll stays 404 until timeout.
	const challenge = base64Url(createHash('sha256').update(verifier, 'utf8').digest());
	const uuid = deps.randomUuid();
	const params = new URLSearchParams({ challenge, uuid, mode: 'login', redirectTarget: 'cli' });
	return { verifier, challenge, uuid, url: `${loginUrl}?${params.toString()}` };
}

function tokens(value: unknown): { readonly accessToken: string; readonly refreshToken: string } {
	if (
		!isRecord(value) ||
		typeof value['accessToken'] !== 'string' ||
		value['accessToken'] === '' ||
		typeof value['refreshToken'] !== 'string' ||
		value['refreshToken'] === ''
	) {
		throw new Error('Cursor authentication response is missing tokens');
	}
	return { accessToken: value['accessToken'], refreshToken: value['refreshToken'] };
}

export function cursorTokenExpiry(token: string): number {
	const payload = token.split('.')[1];
	if (payload === undefined || payload === '') throw new Error('Cursor access token is not a JWT');
	let decoded: unknown;
	try {
		decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch (error) {
		throw new Error('Cursor access token has an invalid JWT payload', { cause: error });
	}
	if (
		!isRecord(decoded) ||
		typeof decoded['exp'] !== 'number' ||
		!Number.isSafeInteger(decoded['exp'])
	) {
		throw new Error('Cursor access token has no valid expiry');
	}
	return decoded['exp'] * 1_000 - expirySkewMs;
}

export async function pollCursorAuth(
	request: Pick<CursorAuthRequest, 'uuid' | 'verifier'>,
	signal: AbortSignal,
	deps: Pick<CursorAuthDependencies, 'fetch' | 'sleep'> = dependencies,
): Promise<OAuthCredential> {
	let pollDelay = basePollDelayMs;
	let consecutiveErrors = 0;
	for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
		await deps.sleep(pollDelay, signal);
		signal.throwIfAborted();
		try {
			const url = new URL(pollUrl);
			url.search = new URLSearchParams(request).toString();
			const response = await deps.fetch(url, { signal });
			if (response.status === 404) {
				consecutiveErrors = 0;
				pollDelay = Math.min(pollDelay * backoffMultiplier, maxPollDelayMs);
				continue;
			}
			if (!response.ok)
				throw new Error(`Cursor login poll returned HTTP ${String(response.status)}`);
			const result = tokens(await response.json());
			return {
				type: 'oauth',
				access: result.accessToken,
				refresh: result.refreshToken,
				expires: cursorTokenExpiry(result.accessToken),
			};
		} catch (error) {
			if (signal.aborted) throw error;
			consecutiveErrors += 1;
			if (consecutiveErrors >= maxConsecutiveErrors) {
				throw new Error('Cursor login polling failed three consecutive times', { cause: error });
			}
		}
	}
	throw new Error('Cursor login polling timed out');
}

/**
 * Refresh per the measured CLI contract, not the oh-my-pi prior art.
 *
 * `exchange_user_api_key` bearers a Cursor **User API Key** — the CLI's separate
 * `cursor-api-key` keychain credential. Measured 2026-09-02: both login JWTs are
 * rejected there with 401 `Invalid User API Key`, and the CLI's browser login never
 * writes an API key, so a browser login never refreshes at all; it rides the 60-day
 * access token and re-logins at expiry. This refresh therefore exchanges the
 * `PI_CURSOR_API_KEY` machine key when configured and otherwise fails with re-login
 * guidance, which Pi surfaces as an OAuth auth error while preserving the stored
 * credential.
 */
export async function refreshCursorToken(
	_credential: OAuthCredential,
	signal: AbortSignal,
	request: CursorFetch = fetch,
	env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<OAuthCredential> {
	const apiKey = env[apiKeyEnvironmentVariable]?.trim();
	if (apiKey === undefined || apiKey === '') {
		throw new Error(
			`Cursor browser sign-ins cannot refresh programmatically; sign in again with /login cursor or set $${apiKeyEnvironmentVariable}`,
		);
	}
	const response = await request(refreshUrl, {
		method: 'POST',
		headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
		body: '{}',
		signal,
	});
	if (!response.ok) {
		throw new Error(`Cursor token refresh returned HTTP ${String(response.status)}`);
	}
	const result = tokens(await response.json());
	return {
		type: 'oauth',
		access: result.accessToken,
		refresh: result.refreshToken,
		expires: cursorTokenExpiry(result.accessToken),
	};
}

export function cursorOAuth(deps: CursorAuthDependencies = dependencies): OAuthAuth {
	return {
		name: 'Cursor',
		isSubscription: true,
		loginLabel: 'Sign in with Cursor',
		login: async (interaction: ProviderAuthInteraction) => {
			const request = createCursorAuthRequest(deps);
			interaction.notify({
				type: 'auth_url',
				url: request.url,
				instructions: 'Complete Cursor sign-in in your browser.',
			});
			interaction.notify({ type: 'progress', message: 'Waiting for Cursor sign-in…' });
			return await pollCursorAuth(request, interaction.signal, deps);
		},
		refresh: async (credential, signal) => await refreshCursorToken(credential, signal, deps.fetch),
		toAuth: async (credential) => ({ apiKey: credential.access }),
	};
}
