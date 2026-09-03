import type {
	CursorUsage,
	OnDemandSpend,
	SpendSeries,
	SpendUsage,
	StandardUsage,
} from '@cursor/usage';
import { formatPercent, formatUsdFromCents, formatUsdFromDollars } from '@cursor/usage';
import { match } from 'ts-pattern';

export const usageBarWidth = 28;
const sparkRamp = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

export function renderUsageBar(percent: number, width = usageBarWidth): string {
	const clamped = Math.min(100, Math.max(0, percent));
	const rounded = Math.round((clamped / 100) * width);
	const filled = Math.min(width, clamped > 0 ? Math.max(1, rounded) : 0);
	return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function heldForward(values: SpendSeries): number[] {
	const held: number[] = [];
	let last = 0;
	for (const value of values) {
		last = value ?? last;
		held.push(last);
	}
	return held;
}

export function lastKnown(values: SpendSeries): number | undefined {
	return values.findLast((value) => value !== undefined);
}

export function renderSparkline(values: SpendSeries, max: number, width = usageBarWidth): string {
	if (values.length === 0) return sparkRamp[0].repeat(width);
	const points = heldForward(values);
	const last = sparkRamp.length - 1;
	return Array.from({ length: width }, (_unused, column) => {
		const position = (column / Math.max(width - 1, 1)) * (points.length - 1);
		const low = Math.floor(position);
		const high = Math.min(low + 1, points.length - 1);
		const value =
			(points[low] ?? 0) + ((points[high] ?? 0) - (points[low] ?? 0)) * (position - low);
		const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
		return sparkRamp[Math.round(ratio * last)] ?? sparkRamp[0];
	}).join('');
}

export interface UsageMeter {
	readonly title: string;
	readonly bar: string;
	readonly details: readonly string[];
}

function onDemandMeter(onDemand: OnDemandSpend): UsageMeter {
	return match(onDemand)
		.with({ kind: 'fixed' }, (self) => ({
			title: 'On-Demand',
			bar: renderUsageBar(self.limitDollars > 0 ? (self.usedDollars / self.limitDollars) * 100 : 0),
			details: [
				`${formatUsdFromDollars(self.usedDollars)} / ${formatUsdFromDollars(self.limitDollars)}`,
				`${formatUsdFromDollars(Math.max(self.limitDollars - self.usedDollars, 0))} remaining`,
			],
		}))
		.with({ kind: 'unlimited' }, (self) => ({
			title: 'On-Demand',
			bar: '·'.repeat(usageBarWidth),
			details: [
				formatUsdFromDollars(self.usedDollars),
				self.scope === 'team-member' ? 'no personal limit' : 'no monthly limit',
			],
		}))
		.with({ kind: 'disabled' }, (self) => ({
			title: 'On-Demand',
			bar: '·'.repeat(usageBarWidth),
			details: [
				self.usedDollars > 0 ? formatUsdFromDollars(self.usedDollars) : 'disabled',
				'on-demand usage is off',
			],
		}))
		.with({ kind: 'unavailable' }, (self) => ({
			title: 'On-Demand',
			bar: '·'.repeat(usageBarWidth),
			details: [
				self.usedDollars > 0 ? formatUsdFromDollars(self.usedDollars) : 'unavailable',
				'on-demand limit unavailable',
			],
		}))
		.exhaustive();
}

function standardMeters(model: StandardUsage): UsageMeter[] {
	return [
		{
			title: 'Included',
			bar: renderUsageBar(model.includedTotalPercent),
			details: [`${formatPercent(model.includedTotalPercent)} used`],
		},
		{
			title: '  Auto',
			bar: renderUsageBar(model.includedAutoPercent),
			details: [`${formatPercent(model.includedAutoPercent)} used`],
		},
		{
			title: '  API',
			bar: renderUsageBar(model.includedApiPercent),
			details: [`${formatPercent(model.includedApiPercent)} used`],
		},
		onDemandMeter(model.onDemand),
	];
}

function spendScale(model: SpendUsage): number {
	return Math.max(0, lastKnown(model.currentCycle) ?? 0, lastKnown(model.previousPeriod) ?? 0);
}

function seriesDetails(values: SpendSeries): string[] {
	const samples = values.slice(1);
	const total = lastKnown(samples);
	if (total === undefined) return ['no sample answered'];
	const missing = samples.filter((value) => value === undefined).length;
	if (missing === 0) return [formatUsdFromDollars(total)];
	const lost = `${missing} of ${samples.length} samples missing`;
	const exact = samples.at(-1) !== undefined;
	return [formatUsdFromDollars(total), exact ? lost : `at least — ${lost}`];
}

function spendMeters(model: SpendUsage): UsageMeter[] {
	const max = spendScale(model);
	return [
		{
			title: 'Current cycle',
			bar: renderSparkline(model.currentCycle, max),
			details: seriesDetails(model.currentCycle),
		},
		{
			title: 'Previous period',
			bar: renderSparkline(model.previousPeriod, max),
			details: seriesDetails(model.previousPeriod),
		},
	];
}

function modelMeters(model: SpendUsage): UsageMeter[] {
	const costliest = model.models.toSorted((left, right) => right.totalCents - left.totalCents);
	const max = Math.max(0, ...costliest.map((entry) => entry.totalCents));
	return costliest.map((entry) => ({
		title: entry.modelIntent,
		bar: renderUsageBar(max > 0 ? (entry.totalCents / max) * 100 : 0),
		details: [
			formatUsdFromCents(entry.totalCents),
			`in ${formatTokens(entry.inputTokens)}`,
			`out ${formatTokens(entry.outputTokens)}`,
			`cache ${formatTokens(entry.cacheReadTokens)}r/${formatTokens(entry.cacheWriteTokens)}w`,
		],
	}));
}

export function formatTokens(count: bigint): string {
	const value = Number(count);
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
	return String(count);
}

export interface UsageTab {
	readonly id: string;
	readonly title: string;
	readonly meters: readonly UsageMeter[];
}

export function cursorUsageTabs(usage: CursorUsage): readonly [UsageTab, ...UsageTab[]] {
	return match<CursorUsage['model'], readonly [UsageTab, ...UsageTab[]]>(usage.model)
		.with({ kind: 'standard' }, (model) => [
			{ id: 'summary', title: 'Summary', meters: standardMeters(model) },
		])
		.with({ kind: 'spend' }, (model) => [
			{ id: 'summary', title: 'Summary', meters: spendMeters(model) },
			...(model.models.length > 0
				? [{ id: 'models', title: 'Models', meters: modelMeters(model) }]
				: []),
		])
		.exhaustive();
}

export function usageHeadline(usage: CursorUsage): string {
	return `${usage.model.planName} · ${usage.model.resetLabel}`;
}

export function formatCursorUsageSummary(usage: CursorUsage, tabId = 'summary'): string[] {
	const tabs = cursorUsageTabs(usage);
	const tab = tabs.find((candidate) => candidate.id === tabId) ?? tabs[0];
	const lines = [usageHeadline(usage)];
	const labelWidth = tab.meters.reduce((width, meter) => Math.max(width, meter.title.length), 0);
	for (const meter of tab.meters) {
		const details = meter.details.length === 0 ? 'no data' : meter.details.join(' · ');
		lines.push(`  ● ${meter.title.padEnd(labelWidth)}  ${meter.bar}  ${details}`);
	}
	if (tab.meters.length === 0) lines.push('  no usage recorded in this period');
	for (const miss of usage.misses) lines.push(`  ${miss.method} failed: ${miss.message}`);
	return lines;
}
