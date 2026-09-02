import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { isRecord } from '@victor-software-house/pi-type-kit';

const loginUrl = 'https://cursor.com/loginDeepControl';
const pollUrl = 'https://api2.cursor.sh/auth/poll';
const refreshUrl = 'https://api2.cursor.sh/oauth/token';
const refreshClientId = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';
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

function accessToken(value: unknown): string {
	if (
		!isRecord(value) ||
		typeof value['access_token'] !== 'string' ||
		value['access_token'] === ''
	) {
		throw new Error('Cursor refresh response is missing an access token');
	}
	return value['access_token'];
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
 * Refresh per the measured IDE workbench contract — the only client that refreshes
 * a browser login. Extracted from the pinned 3.18.9 workbench and measured live
 * 2026-09-02: `POST /oauth/token` with an OAuth2 refresh-token grant consumes the
 * PKCE login's refresh JWT and returns a fresh 60-day access JWT. The refresh JWT
 * is durable and non-rotating (the response carries no `refresh_token`; repeated
 * grants with the same token each returned 200). `exchange_user_api_key` is a
 * different endpoint that bearers a User API Key and rejects both login JWTs with
 * 401 — the CLI, agent-host, and SDK never refresh a browser login at all.
 * `shouldLogout: true` means the server revoked the session (e.g. MDM sign-in
 * policy); treat it as a re-login error while Pi preserves the stored credential.
 */
export async function refreshCursorToken(
	credential: OAuthCredential,
	signal: AbortSignal,
	request: CursorFetch = fetch,
): Promise<OAuthCredential> {
	const response = await request(refreshUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'refresh_token',
			client_id: refreshClientId,
			refresh_token: credential.refresh,
		}),
		signal,
	});
	if (!response.ok) {
		throw new Error(`Cursor token refresh returned HTTP ${String(response.status)}`);
	}
	const result: unknown = await response.json();
	if (isRecord(result) && result['shouldLogout'] === true) {
		throw new Error('Cursor revoked this session; sign in again with /login cursor');
	}
	const access = accessToken(result);
	return {
		type: 'oauth',
		access,
		refresh: credential.refresh,
		expires: cursorTokenExpiry(access),
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
