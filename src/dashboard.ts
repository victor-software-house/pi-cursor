import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { DescMessage, MessageShape } from '@bufbuild/protobuf';
import { fromBinary, toBinary } from '@bufbuild/protobuf';
import type { Result } from '@victor-software-house/pi-type-kit';
import { err, ok, thrownMessage } from '@victor-software-house/pi-type-kit';

const backendUrl = 'https://api2.cursor.sh';
const service = 'aiserver.v1.DashboardService';
const responseLimit = 4 * 1024 * 1024;
const timeoutMs = 10_000;

export type DashboardErrorKind = 'auth' | 'permanent' | 'transient' | 'invalid';

export interface DashboardError {
	readonly kind: DashboardErrorKind;
	readonly method: string;
	readonly message: string;
}

export interface DashboardCallOptions {
	readonly token: string;
	readonly signal?: AbortSignal;
	/** Loopback test seam. Production always uses node:https. */
	readonly request?: CursorHttpRequest;
}

export type CursorHttpRequest = (
	options: RequestOptions,
	callback: (response: IncomingMessage) => void,
) => ClientRequest;

interface RawResponse {
	readonly status: number;
	readonly body: Uint8Array;
}

function headersFor(options: DashboardCallOptions, body: Uint8Array): Record<string, string> {
	const headers: Record<string, string> = {
		'accept-encoding': 'gzip,br',
		authorization: `Bearer ${options.token}`,
		'connect-protocol-version': '1',
		'connect-timeout-ms': String(timeoutMs),
		'content-type': 'application/proto',
		'user-agent': 'connect-es/1.6.1',
		'x-cursor-client-type': 'cli',
		'x-cursor-client-version': 'extension-unknown',
		'x-ghost-mode': 'false',
		'x-request-id': crypto.randomUUID(),
	};
	if (body.length === 0) headers['content-length'] = '0';
	return headers;
}

function decoded(body: Uint8Array, encoding: string | undefined): Uint8Array {
	if (encoding === 'gzip') return new Uint8Array(gunzipSync(body));
	if (encoding === 'br') return new Uint8Array(brotliDecompressSync(body));
	return body;
}

function send(url: URL, options: DashboardCallOptions, body: Uint8Array): Promise<RawResponse> {
	return new Promise<RawResponse>((resolve, reject) => {
		if (options.signal?.aborted === true) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const request = options.request ?? httpsRequest;
		const req = request(
			{
				protocol: 'https:',
				host: url.hostname,
				port: url.port !== '' ? url.port : 443,
				path: url.pathname,
				method: 'POST',
				headers: headersFor(options, body),
			},
			(response) => {
				const chunks: Uint8Array[] = [];
				let size = 0;
				response.on('data', (chunk: Uint8Array) => {
					size += chunk.length;
					if (size > responseLimit) {
						req.destroy();
						reject(new Error(`response exceeded ${String(responseLimit)} bytes`));
						return;
					}
					chunks.push(chunk);
				});
				response.on('end', () => {
					try {
						resolve({
							status: response.statusCode ?? 0,
							body: decoded(Buffer.concat(chunks), response.headers['content-encoding']),
						});
					} catch (error) {
						reject(new Error(thrownMessage(error)));
					}
				});
				response.on('error', reject);
			},
		);
		req.on('error', reject);
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error(`no response within ${String(timeoutMs)}ms`));
		});

		const signal = options.signal;
		if (signal !== undefined) {
			const abort = (): void => {
				req.destroy();
				reject(new DOMException('Aborted', 'AbortError'));
			};
			signal.addEventListener('abort', abort, { once: true });
			req.on('close', () => signal.removeEventListener('abort', abort));
		}

		if (body.length === 0) req.end();
		else {
			req.write(body);
			req.end();
		}
	});
}

function reasonFrom(body: Uint8Array): string | undefined {
	try {
		const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
		if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
			const { message } = parsed;
			if (typeof message === 'string' && message !== '') return message;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function classify(status: number): DashboardErrorKind {
	if (status === 401 || status === 403) return 'auth';
	if (status >= 500) return 'transient';
	return 'permanent';
}

export async function callDashboard<Req extends DescMessage, Res extends DescMessage>(
	method: string,
	request: { readonly schema: Req; readonly message: MessageShape<Req> },
	response: Res,
	options: DashboardCallOptions,
): Promise<Result<MessageShape<Res>, DashboardError>> {
	if (options.token.includes('\r') || options.token.includes('\n')) {
		return err({ kind: 'invalid', method, message: 'Cursor credential contains a line break' });
	}
	const url = new URL(`${backendUrl}/${service}/${method}`);
	const body = toBinary(request.schema, request.message);

	let raw: RawResponse;
	try {
		raw = await send(url, options, body);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			return err({ kind: 'transient', method, message: 'cancelled' });
		}
		return err({ kind: 'transient', method, message: thrownMessage(error) });
	}

	if (raw.status !== 200) {
		const reason = reasonFrom(raw.body);
		return err({
			kind: classify(raw.status),
			method,
			message: `${String(raw.status)}${reason === undefined ? '' : ` — ${reason}`}`,
		});
	}

	try {
		return ok(fromBinary(response, raw.body));
	} catch (error) {
		return err({ kind: 'invalid', method, message: thrownMessage(error) });
	}
}
