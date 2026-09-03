import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { isRecord } from '@victor-software-house/pi-type-kit';

const loginUrl = 'https://cursor.com/loginDeepControl';
const pollUrl = 'https://api2.cursor.sh/auth/poll';
const refreshUrl = 'https://api2.cursor.sh/oauth/token';
const refreshClientId = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';
const pollIntervalMs = 500;
const pollWindowMs = 180_000;
const refreshDeadlineMs = 20_000;
const clientTypeHeader = 'x-cursor-client-type';
const clientType = 'ide';
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
	// Workbench `loginLink` parameter shape (pinned 3.18.9): no redirectTarget — that is the
	// CLI/SDK portal-attribution parameter. The workbench appends mode and
	// supportsSelectedTeamLogin; surface=glass applies only to the glass edition.
	const params = new URLSearchParams({
		challenge,
		uuid,
		mode: 'login',
		supportsSelectedTeamLogin: 'true',
	});
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

/**
 * Workbench poll headers (pinned 3.18.9 `fetchPendingBrowserLoginSession`): traceparent,
 * privacy-mode ghost header, onboarding flag, and the desktop client type. The values here
 * are the workbench's own defaults for a machine with no privacy-mode override and no MDM
 * sign-in policy (whose header helper then contributes nothing).
 */
function workbenchPollHeaders(): Record<string, string> {
	const traceId = randomBytes(16).toString('hex');
	const spanId = randomBytes(8).toString('hex');
	return {
		traceparent: `00-${traceId}-${spanId}-00`,
		'x-ghost-mode': 'implicit-false',
		'x-new-onboarding-completed': 'false',
		[clientTypeHeader]: clientType,
	};
}

class CursorSignInPolicyError extends Error {
	constructor(detail: string) {
		super(`Cursor login denied by sign-in policy: ${detail}`);
		this.name = 'CursorSignInPolicyError';
	}
}

/**
 * Poll exactly like the pinned 3.18.9 workbench: a fixed 500 ms GET interval against
 * `/auth/poll` for the ~180 s login window, with no backoff and no error cap — the
 * workbench's interval callback has no catch, so transient failures just wait for the
 * next tick. `404` means the login is still pending; a `403` carrying the MDM
 * sign-in-policy sentinel means the login was denied; every other failure keeps polling.
 */
export async function pollCursorAuth(
	request: Pick<CursorAuthRequest, 'uuid' | 'verifier'>,
	signal: AbortSignal,
	deps: Pick<CursorAuthDependencies, 'fetch' | 'sleep'> = dependencies,
): Promise<OAuthCredential> {
	const deadline = Date.now() + pollWindowMs;
	while (!signal.aborted && Date.now() < deadline) {
		await deps.sleep(pollIntervalMs, signal);
		if (signal.aborted) break;
		try {
			const url = new URL(pollUrl);
			url.search = new URLSearchParams(request).toString();
			const response = await deps.fetch(url, { headers: workbenchPollHeaders(), signal });
			if (response.status === 404) continue;
			if (response.status === 403) {
				const body: unknown = await response.json().catch(() => undefined);
				if (isRecord(body) && typeof body['error'] === 'string') {
					throw new CursorSignInPolicyError(body['error']);
				}
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
			if (signal.aborted || error instanceof CursorSignInPolicyError) throw error;
		}
	}
	throw new Error('Cursor login polling timed out');
}

/**
 * Refresh per the IDE workbench — the credential owner for the agent-host transport we
 * mirror. Provenance (pinned 3.18.9): the agent-host extension's credentialManager reads
 * `cursor.getCursorAuthToken()` (the workbench-managed token), its `getApiKey()` is always
 * undefined, and its `setAuthentication` merely executes `cursorAuth.triggerTokenRefresh`
 * — so login and refresh are entirely the workbench's. Its `_performAccessTokenRefresh`
 * posts the OAuth2 refresh-token grant below (20 s deadline, `x-cursor-client-type: ide`,
 * MDM headers when configured) and measured live 2026-09-02: the PKCE login's refresh JWT
 * is durable and non-rotating — repeated grants with the same token each returned 200 with
 * a fresh 60-day access JWT, and the response carries no `refresh_token`.
 *
 * Deliberate deviation, measured not invented: the workbench stores the new access token
 * as BOTH access and refresh (`storeAccessRefreshToken(c.access_token, c.access_token)`);
 * pi-cursor keeps the original refresh token, which the server keeps accepting. Granting
 * with an access token as `refresh_token` is unmeasured, so the quirk is not copied.
 * `exchange_user_api_key` is a different endpoint that bearers a User API Key and rejects
 * both login JWTs with 401. `shouldLogout: true` means server-side revocation (e.g. MDM
 * sign-in policy); treat it as a re-login error while Pi preserves the stored credential.
 */
export async function refreshCursorToken(
	credential: OAuthCredential,
	signal: AbortSignal,
	request: CursorFetch = fetch,
): Promise<OAuthCredential> {
	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(), refreshDeadlineMs);
	const onAbort = () => deadline.abort();
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		const response = await request(refreshUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json', [clientTypeHeader]: clientType },
			body: JSON.stringify({
				grant_type: 'refresh_token',
				client_id: refreshClientId,
				refresh_token: credential.refresh,
			}),
			signal: deadline.signal,
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
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
	}
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
