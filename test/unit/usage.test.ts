import { afterEach, describe, expect, test } from 'bun:test';
import type { IncomingHttpHeaders } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { CursorHttpRequest } from '@cursor/dashboard';
import { callDashboard } from '@cursor/dashboard';
import {
	GetAggregatedUsageEventsRequestSchema,
	GetAggregatedUsageEventsResponse_ModelUsageAggregationSchema,
	GetAggregatedUsageEventsResponseSchema,
	GetCurrentPeriodUsageResponseSchema,
	GetHardLimitRequestSchema,
	GetHardLimitResponseSchema,
	GetMeResponseSchema,
	GetMonthlyBillingCycleResponseSchema,
	GetPlanInfoResponseSchema,
} from '@cursor/gen/aiserver/v1/dashboard_pb';
import {
	formatPercent,
	formatResetLabel,
	formatUsdFromCents,
	loadCursorUsage,
	spendWindows,
} from '@cursor/usage';
import { cursorUsageTabs, formatCursorUsageSummary } from '@cursor/usage-view';

const cycleStart = 1_785_542_400_000n;
const cycleEnd = 1_788_220_800_000n;
const nowMillis = 1_787_685_120_000;
const currentCents = [1_000, 4_000, 9_000, 18_000, 25_000] as const;
const previousCents = [2_000, 8_000, 20_000, 40_000, 60_000] as const;
const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function pointFor(start: bigint, end: bigint): number | undefined {
	const previous = start !== cycleStart;
	const base = previous ? start : cycleStart;
	const elapsed = BigInt(nowMillis) - cycleStart;
	for (let point = 1; point <= currentCents.length; point++) {
		if (base + (elapsed * BigInt(point)) / BigInt(currentCents.length) === end) return point;
	}
	return undefined;
}

async function startDashboard(shape: 'standard' | 'enterprise' = 'enterprise') {
	const calls: string[] = [];
	const requests: { headers: IncomingHttpHeaders; body: Buffer }[] = [];
	const server = createServer((request, response) => {
		const method = (request.url ?? '').split('/').pop() ?? '';
		calls.push(method);
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			const body = Buffer.concat(chunks);
			requests.push({ headers: request.headers, body });
			let reply: Uint8Array;
			switch (method) {
				case 'GetCurrentPeriodUsage':
					reply = toBinary(
						GetCurrentPeriodUsageResponseSchema,
						create(GetCurrentPeriodUsageResponseSchema, {
							billingCycleEnd: cycleEnd,
							...(shape === 'standard'
								? {
										planUsage: {
											totalPercentUsed: 42.5,
											autoPercentUsed: 18,
											apiPercentUsed: 0.4,
										},
										spendLimitUsage: { individualUsed: 1_240, individualLimit: 5_000 },
									}
								: {}),
						}),
					);
					break;
				case 'GetHardLimit':
					reply = toBinary(
						GetHardLimitResponseSchema,
						create(GetHardLimitResponseSchema, { hardLimit: 500 }),
					);
					break;
				case 'GetPlanInfo':
					reply = toBinary(
						GetPlanInfoResponseSchema,
						create(GetPlanInfoResponseSchema, {
							planInfo: {
								planName: shape === 'standard' ? 'Pro' : 'Enterprise',
								billingCycleEnd: cycleEnd,
							},
						}),
					);
					break;
				case 'GetMe':
					reply = toBinary(
						GetMeResponseSchema,
						create(GetMeResponseSchema, { userId: 777, teamId: 4242, isEnterpriseUser: true }),
					);
					break;
				case 'GetMonthlyBillingCycle':
					reply = toBinary(
						GetMonthlyBillingCycleResponseSchema,
						create(GetMonthlyBillingCycleResponseSchema, {
							startDateEpochMillis: cycleStart,
							endDateEpochMillis: cycleEnd,
						}),
					);
					break;
				case 'GetAggregatedUsageEvents': {
					const sent = fromBinary(GetAggregatedUsageEventsRequestSchema, body);
					const start = sent.startDate ?? 0n;
					const point = pointFor(start, sent.endDate ?? 0n);
					const previous = start !== cycleStart;
					const cents =
						point === undefined ? 0 : ((previous ? previousCents : currentCents)[point - 1] ?? 0);
					reply = toBinary(
						GetAggregatedUsageEventsResponseSchema,
						create(GetAggregatedUsageEventsResponseSchema, {
							totalCostCents: cents,
							aggregations:
								previous || point !== 5
									? []
									: [
											create(GetAggregatedUsageEventsResponse_ModelUsageAggregationSchema, {
												modelIntent: 'cursor-grok-4.6',
												inputTokens: 9_000_000n,
												outputTokens: 400_000n,
												totalCents: 25_000,
											}),
										],
						}),
					);
					break;
				}
				default:
					response.writeHead(404).end();
					return;
			}
			response.writeHead(200, { 'content-type': 'application/proto' }).end(reply);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('dashboard has no port');
	const request: CursorHttpRequest = (options, callback) =>
		httpRequest({ ...options, protocol: 'http:', host: '127.0.0.1', port: address.port }, callback);
	cleanups.push(() => server.close());
	return { calls, requests, request };
}

describe('Cursor usage data', () => {
	test('builds the measured five cumulative windows for both cycles', () => {
		const windows = spendWindows(cycleStart, cycleEnd, nowMillis);
		expect(windows).toHaveLength(10);
		expect(windows.filter(({ cycle }) => cycle === 'current').at(-1)?.endDate).toBe(
			BigInt(nowMillis),
		);
		expect(windows.map(({ point }) => point)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
	});

	test('loads ordinary plan percentages and dollar-denominated hard limit', async () => {
		const dashboard = await startDashboard('standard');
		const result = await loadCursorUsage({
			token: 'HEADER.PAYLOAD.SIGNATURE',
			nowMillis,
			request: dashboard.request,
		});
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.model).toMatchObject({
			kind: 'standard',
			planName: 'Pro',
			includedTotalPercent: 42.5,
			onDemand: { kind: 'fixed', usedDollars: 12.4, limitDollars: 500 },
		});
		expect(dashboard.calls).not.toContain('GetAggregatedUsageEvents');
	});

	test('loads enterprise cycle totals and per-model token spend', async () => {
		const dashboard = await startDashboard();
		const result = await loadCursorUsage({
			token: 'HEADER.PAYLOAD.SIGNATURE',
			nowMillis,
			request: dashboard.request,
		});
		if (!result.ok) throw new Error(result.error.message);
		if (result.value.model.kind !== 'spend') throw new Error('expected spend usage');
		expect(result.value.model.currentCycle).toEqual([0, 10, 40, 90, 180, 250]);
		expect(result.value.model.previousPeriod).toEqual([0, 20, 80, 200, 400, 600]);
		expect(result.value.model.models[0]?.modelIntent).toBe('cursor-grok-4.6');
		expect(cursorUsageTabs(result.value).map(({ title }) => title)).toEqual(['Summary', 'Models']);
		expect(formatCursorUsageSummary(result.value, 'models').join('\n')).toContain(
			'$250.00 · in 9.00M · out 400.00K',
		);
		expect(dashboard.calls.filter((method) => method === 'GetAggregatedUsageEvents')).toHaveLength(
			10,
		);
	});

	test('uses the captured dashboard identity and body framing', async () => {
		const dashboard = await startDashboard();
		await callDashboard(
			'GetHardLimit',
			{ schema: GetHardLimitRequestSchema, message: create(GetHardLimitRequestSchema) },
			GetHardLimitResponseSchema,
			{ token: 'HEADER.PAYLOAD.SIGNATURE', request: dashboard.request },
		);
		const sent = dashboard.requests[0];
		expect(sent?.headers['authorization']).toBe('Bearer HEADER.PAYLOAD.SIGNATURE');
		expect(sent?.headers['user-agent']).toBe('connect-es/1.6.1');
		expect(sent?.headers['x-cursor-client-version']).toBe('extension-unknown');
		expect(sent?.headers['x-ghost-mode']).toBe('false');
		expect(sent?.headers['content-length']).toBe('0');
		expect(sent?.headers['transfer-encoding']).toBeUndefined();
	});

	test('formats measured units without rounding real usage to zero', () => {
		expect(formatUsdFromCents(0.4)).toBe('<$0.01');
		expect(formatPercent(0.4)).toBe('1%');
		expect(formatResetLabel(cycleEnd)).toBe('Resets Sep 1');
	});
});
