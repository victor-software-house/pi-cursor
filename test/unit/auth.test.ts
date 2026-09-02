import { describe, expect, test } from 'bun:test';
import {
	createCursorAuthRequest,
	cursorTokenExpiry,
	pollCursorAuth,
	refreshCursorToken,
} from '@cursor/auth';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const expirySeconds = 2_000_000_000;

function token(exp: number = expirySeconds): string {
	return [
		Buffer.from('{}').toString('base64url'),
		Buffer.from(JSON.stringify({ exp })).toString('base64url'),
		'signature',
	].join('.');
}

describe('Cursor OAuth', () => {
	test('constructs the captured challenge and browser URL', () => {
		const request = createCursorAuthRequest({
			randomBytes: () => new Uint8Array(Array.from({ length: 32 }, (_, index) => index)),
			randomUuid: () => uuid,
		});
		expect(request).toEqual({
			verifier: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
			challenge: '6oZqdX5MOLq_qBJ8vppAnT4fk6AP8UiP9zX8-Rev_9A',
			uuid,
			url: `https://cursor.com/loginDeepControl?challenge=6oZqdX5MOLq_qBJ8vppAnT4fk6AP8UiP9zX8-Rev_9A&uuid=${uuid}&mode=login&redirectTarget=cli`,
		});
	});

	test('reads JWT expiry with the five-minute refresh skew', () => {
		expect(cursorTokenExpiry(token())).toBe(expirySeconds * 1_000 - 5 * 60 * 1_000);
		expect(() => cursorTokenExpiry('not-a-jwt')).toThrow('not a JWT');
	});

	test('treats 404 as pending and accepts the first complete token pair', async () => {
		const delays: number[] = [];
		const urls: string[] = [];
		let calls = 0;
		const credential = await pollCursorAuth(
			{ uuid, verifier: 'verifier' },
			new AbortController().signal,
			{
				sleep: async (milliseconds) => {
					delays.push(milliseconds);
				},
				fetch: async (input) => {
					urls.push(input instanceof Request ? input.url : input.toString());
					calls += 1;
					return calls === 1
						? new Response('pending', { status: 404 })
						: Response.json({ accessToken: token(), refreshToken: 'refresh' });
				},
			},
		);
		expect(delays).toEqual([1_000, 1_200]);
		expect(urls[0]).toBe(`https://api2.cursor.sh/auth/poll?uuid=${uuid}&verifier=verifier`);
		expect(credential).toEqual({
			type: 'oauth',
			access: token(),
			refresh: 'refresh',
			expires: expirySeconds * 1_000 - 5 * 60 * 1_000,
		});
	});

	test('exchanges a configured machine API key as bearer', async () => {
		let authorization: string | null = null;
		const env = { PI_CURSOR_API_KEY: 'machine-key' };
		const refreshed = await refreshCursorToken(
			{ type: 'oauth', access: token(), refresh: 'refresh-token', expires: 0 },
			new AbortController().signal,
			async (_input, init) => {
				if (init === undefined) throw new Error('refresh request options are missing');
				authorization = new Headers(init.headers).get('authorization');
				expect(init.body).toBe('{}');
				return Response.json({ accessToken: token(expirySeconds + 1), refreshToken: 'next' });
			},
			env,
		);
		expect(String(authorization)).toBe('Bearer machine-key');
		expect(refreshed.refresh).toBe('next');
	});

	test('refuses to refresh a browser login instead of sending a rejected JWT', async () => {
		let called = false;
		let failure: unknown;
		try {
			await refreshCursorToken(
				{ type: 'oauth', access: token(), refresh: 'refresh-token', expires: 0 },
				new AbortController().signal,
				async () => {
					called = true;
					return Response.json({ accessToken: token(), refreshToken: 'next' });
				},
				{},
			);
		} catch (error) {
			failure = error;
		}
		expect(called).toBe(false);
		expect(failure).toBeInstanceOf(Error);
		if (!(failure instanceof Error)) throw new Error('expected an Error');
		expect(failure.message).toContain('/login cursor');
		expect(failure.message).toContain('PI_CURSOR_API_KEY');
	});
});
