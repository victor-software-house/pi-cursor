import { create } from '@bufbuild/protobuf';
import type { CursorHttpRequest, DashboardError } from '@cursor/dashboard';
import { callDashboard } from '@cursor/dashboard';
import type {
	GetAggregatedUsageEventsResponse,
	GetCurrentPeriodUsageResponse,
	GetHardLimitResponse,
} from '@cursor/gen/aiserver/v1/dashboard_pb';
import {
	GetAggregatedUsageEventsRequestSchema,
	GetAggregatedUsageEventsResponseSchema,
	GetCurrentPeriodUsageRequestSchema,
	GetCurrentPeriodUsageResponseSchema,
	GetHardLimitRequestSchema,
	GetHardLimitResponseSchema,
	GetMeRequestSchema,
	GetMeResponseSchema,
	GetMonthlyBillingCycleRequestSchema,
	GetMonthlyBillingCycleResponseSchema,
	GetPlanInfoRequestSchema,
	GetPlanInfoResponseSchema,
} from '@cursor/gen/aiserver/v1/dashboard_pb';
import type { Result } from '@victor-software-house/pi-type-kit';
import { err, ok } from '@victor-software-house/pi-type-kit';
import { match } from 'ts-pattern';

const spendPoints = 5;
const spendConcurrency = 4;
const unlimitedHardLimit = 2_147_483_647;

export type OnDemandSpend =
	| { readonly kind: 'fixed'; readonly usedDollars: number; readonly limitDollars: number }
	| {
			readonly kind: 'unlimited';
			readonly usedDollars: number;
			readonly scope: 'personal' | 'team-member';
	  }
	| { readonly kind: 'disabled'; readonly usedDollars: number }
	| { readonly kind: 'unavailable'; readonly usedDollars: number };

export interface StandardUsage {
	readonly kind: 'standard';
	readonly planName: string;
	readonly resetLabel: string;
	readonly includedTotalPercent: number;
	readonly includedAutoPercent: number;
	readonly includedApiPercent: number;
	readonly onDemand: OnDemandSpend;
}

export type SpendSeries = readonly (number | undefined)[];

export interface SpendUsage {
	readonly kind: 'spend';
	readonly planName: string;
	readonly resetLabel: string;
	readonly currentCycle: SpendSeries;
	readonly previousPeriod: SpendSeries;
	readonly models: GetAggregatedUsageEventsResponse['aggregations'];
}

export interface CursorUsage {
	readonly model: StandardUsage | SpendUsage;
	readonly misses: readonly DashboardError[];
}

export interface LoadCursorUsageOptions {
	readonly token: string;
	readonly signal?: AbortSignal;
	readonly nowMillis?: number;
	readonly request?: CursorHttpRequest;
}

function refuse(message: string): Result<CursorUsage, DashboardError> {
	return err({ kind: 'permanent', method: 'GetCurrentPeriodUsage', message });
}

export function formatResetLabel(billingCycleEnd: bigint | undefined): string {
	const millis = Number(billingCycleEnd ?? 0n);
	if (millis <= 0) return 'Current period';
	const date = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(millis));
	return `Resets ${date}`;
}

export function formatPercent(percent: number): string {
	const clamped = Math.max(0, Math.min(100, percent));
	return `${clamped > 0 && clamped < 1 ? 1 : Math.round(clamped)}%`;
}

export function formatUsdFromCents(cents: number): string {
	const dollars = Math.abs(cents) / 100;
	const sign = cents < 0 ? '-' : '';
	if (dollars > 0 && dollars < 0.01) return `${sign}<$0.01`;
	return `${sign}$${dollars.toFixed(2)}`;
}

export function formatUsdFromDollars(dollars: number): string {
	return formatUsdFromCents(dollars * 100);
}

function percentOf(
	percentage: number | undefined,
	used: number | undefined,
	limit: number | undefined,
): number {
	if (percentage !== undefined) return percentage;
	if (limit !== undefined && limit > 0) return ((used ?? 0) / limit) * 100;
	return 0;
}

function onDemandFrom(
	spendLimit: GetCurrentPeriodUsageResponse['spendLimitUsage'],
	hardLimit: GetHardLimitResponse | undefined,
): OnDemandSpend {
	const usedDollars = (spendLimit?.individualUsed ?? 0) / 100;
	const individualLimit = spendLimit?.individualLimit;
	const individual: OnDemandSpend | undefined =
		individualLimit === undefined
			? undefined
			: individualLimit > 0
				? { kind: 'fixed', usedDollars, limitDollars: individualLimit / 100 }
				: { kind: 'disabled', usedDollars };

	if (spendLimit?.limitType === 'team') {
		if (individual !== undefined) return individual;
		if (hardLimit !== undefined) {
			return hardLimit.noUsageBasedAllowed || hardLimit.hardLimit <= 0
				? { kind: 'disabled', usedDollars }
				: { kind: 'unlimited', usedDollars, scope: 'team-member' };
		}
		return (spendLimit.pooledLimit ?? 0) > 0
			? { kind: 'unlimited', usedDollars, scope: 'team-member' }
			: { kind: 'unavailable', usedDollars };
	}

	if (hardLimit === undefined) return individual ?? { kind: 'unavailable', usedDollars };
	if (hardLimit.noUsageBasedAllowed) return { kind: 'disabled', usedDollars };
	if (hardLimit.hardLimit >= unlimitedHardLimit) {
		return { kind: 'unlimited', usedDollars, scope: 'personal' };
	}
	return hardLimit.hardLimit > 0
		? { kind: 'fixed', usedDollars, limitDollars: hardLimit.hardLimit }
		: { kind: 'disabled', usedDollars };
}

export interface SpendWindow {
	readonly cycle: 'current' | 'previous';
	readonly point: number;
	readonly startDate: bigint;
	readonly endDate: bigint;
}

export function spendWindows(
	cycleStart: bigint,
	cycleEnd: bigint,
	nowMillis: number,
): SpendWindow[] {
	const now = BigInt(Math.floor(nowMillis));
	const clamped = BigInt(Math.min(Number(cycleEnd), Math.max(Number(cycleStart), Number(now))));
	const elapsed = clamped - cycleStart;
	if (elapsed <= 0n) return [];
	const previousStart = cycleStart - (cycleEnd - cycleStart);
	const windows: SpendWindow[] = [];
	for (let point = 1; point <= spendPoints; point++) {
		const reached = (elapsed * BigInt(point)) / BigInt(spendPoints);
		windows.push(
			{ cycle: 'current', point, startDate: cycleStart, endDate: cycleStart + reached },
			{ cycle: 'previous', point, startDate: previousStart, endDate: previousStart + reached },
		);
	}
	return windows;
}

async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = next;
			next += 1;
			const item = items[index];
			if (item === undefined) return;
			results[index] = await run(item);
		}
	});
	await Promise.all(workers);
	return results;
}

export async function loadCursorUsage(
	options: LoadCursorUsageOptions,
): Promise<Result<CursorUsage, DashboardError>> {
	const callOptions = {
		token: options.token,
		...(options.signal === undefined ? {} : { signal: options.signal }),
		...(options.request === undefined ? {} : { request: options.request }),
	};
	const misses: DashboardError[] = [];
	const record = <T>(result: Result<T, DashboardError>): T | undefined => {
		if (result.ok) return result.value;
		misses.push(result.error);
		return undefined;
	};

	const [period, hardLimit, plan] = await Promise.all([
		callDashboard(
			'GetCurrentPeriodUsage',
			{
				schema: GetCurrentPeriodUsageRequestSchema,
				message: create(GetCurrentPeriodUsageRequestSchema),
			},
			GetCurrentPeriodUsageResponseSchema,
			callOptions,
		),
		callDashboard(
			'GetHardLimit',
			{ schema: GetHardLimitRequestSchema, message: create(GetHardLimitRequestSchema) },
			GetHardLimitResponseSchema,
			callOptions,
		),
		callDashboard(
			'GetPlanInfo',
			{ schema: GetPlanInfoRequestSchema, message: create(GetPlanInfoRequestSchema) },
			GetPlanInfoResponseSchema,
			callOptions,
		),
	]);
	if (!period.ok) return err(period.error);
	const limits = record(hardLimit);
	const planInfo = record(plan)?.planInfo;
	const finish = (model: StandardUsage | SpendUsage): Result<CursorUsage, DashboardError> =>
		ok({ model, misses });

	const planUsage = period.value.planUsage;
	if (planUsage !== undefined) {
		const cycleEnd =
			period.value.billingCycleEnd > 0n ? period.value.billingCycleEnd : planInfo?.billingCycleEnd;
		return finish({
			kind: 'standard',
			planName: planInfo?.planName ?? 'Current plan',
			resetLabel: formatResetLabel(cycleEnd),
			includedTotalPercent: percentOf(
				planUsage.totalPercentUsed,
				planUsage.includedSpend,
				planUsage.limit,
			),
			includedAutoPercent: planUsage.autoPercentUsed ?? 0,
			includedApiPercent: planUsage.apiPercentUsed ?? 0,
			onDemand: onDemandFrom(period.value.spendLimitUsage, limits),
		});
	}

	const me = await callDashboard(
		'GetMe',
		{ schema: GetMeRequestSchema, message: create(GetMeRequestSchema) },
		GetMeResponseSchema,
		callOptions,
	);
	if (!me.ok) return err(me.error);
	if (me.value.isEnterpriseUser !== true) {
		return refuse('Usage details are not available for this plan.');
	}
	const { teamId, userId } = me.value;
	if (teamId === undefined || teamId === 0 || userId === 0) {
		return refuse('Enterprise spend details are not available for this account.');
	}

	const cycle = await callDashboard(
		'GetMonthlyBillingCycle',
		{
			schema: GetMonthlyBillingCycleRequestSchema,
			message: create(GetMonthlyBillingCycleRequestSchema),
		},
		GetMonthlyBillingCycleResponseSchema,
		callOptions,
	);
	if (!cycle.ok) return err(cycle.error);

	const windows = spendWindows(
		cycle.value.startDateEpochMillis,
		cycle.value.endDateEpochMillis,
		options.nowMillis ?? Date.now(),
	);
	const currentCycle: (number | undefined)[] = Array.from({ length: spendPoints + 1 });
	const previousPeriod: (number | undefined)[] = Array.from({ length: spendPoints + 1 });
	currentCycle[0] = 0;
	previousPeriod[0] = 0;
	let models: SpendUsage['models'] = [];

	const sampled = await mapLimit(windows, spendConcurrency, (window) =>
		callDashboard(
			'GetAggregatedUsageEvents',
			{
				schema: GetAggregatedUsageEventsRequestSchema,
				message: create(GetAggregatedUsageEventsRequestSchema, {
					teamId,
					userId,
					startDate: window.startDate,
					endDate: window.endDate,
				}),
			},
			GetAggregatedUsageEventsResponseSchema,
			callOptions,
		),
	);
	for (const [index, result] of sampled.entries()) {
		const window = windows[index];
		if (window === undefined) continue;
		const value = record(result);
		if (value === undefined) continue;
		const dollars = Math.max(0, value.totalCostCents) / 100;
		match(window.cycle)
			.with('current', () => {
				currentCycle[window.point] = dollars;
				models = value.aggregations;
			})
			.with('previous', () => {
				previousPeriod[window.point] = dollars;
			})
			.exhaustive();
	}

	return finish({
		kind: 'spend',
		planName: planInfo?.planName ?? 'Enterprise',
		resetLabel: formatResetLabel(cycle.value.endDateEpochMillis),
		currentCycle,
		previousPeriod,
		models,
	});
}
