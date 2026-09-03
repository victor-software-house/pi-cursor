import { describe, expect, test } from 'bun:test';
import type { CursorUsage, SpendUsage, StandardUsage } from '@cursor/usage';
import type { CursorUsageState } from '@cursor/usage-panel';
import {
	createUsageLoads,
	cursorUsageFooter,
	cursorUsagePaneKey,
	cursorUsageRows,
	cursorUsageTabStrip,
} from '@cursor/usage-panel';
import { cursorUsageTabs } from '@cursor/usage-view';
import type { Theme } from '@earendil-works/pi-coding-agent';
import { err, ok } from '@victor-software-house/pi-type-kit';

const theme: Pick<Theme, 'fg' | 'bold'> = {
	fg: (color, text) => `<${color}>${text}`,
	bold: (text) => `<b>${text}`,
};

const standard: StandardUsage = {
	kind: 'standard',
	planName: 'Pro',
	resetLabel: 'Resets Sep 1',
	includedTotalPercent: 42.5,
	includedAutoPercent: 18,
	includedApiPercent: 0.4,
	onDemand: { kind: 'fixed', usedDollars: 12.4, limitDollars: 50 },
};

const spend: SpendUsage = {
	kind: 'spend',
	planName: 'Enterprise',
	resetLabel: 'Resets Sep 1',
	currentCycle: [0, 10, 40, 90, 180, 250],
	previousPeriod: [0, 20, 80, 200, 400, 600],
	models: [],
};

function usage(model: CursorUsage['model'] = standard): CursorUsage {
	return { model, misses: [] };
}

describe('Cursor usage pane decisions', () => {
	test('paints the headline, meters, and partial failures by semantic role', () => {
		const rows = cursorUsageRows(
			theme,
			{
				...usage(),
				misses: [{ kind: 'transient', method: 'GetPlanInfo', message: '500 — upstream' }],
			},
			'summary',
			200,
		);
		expect(rows[1]).toBe('  <accent><b>Pro · Resets Sep 1');
		expect(rows[2]).toStartWith('  <text>  ● Included');
		expect(rows.at(-1)).toBe('  <error>  GetPlanInfo failed: 500 — upstream');
	});

	test('offers Models only when a breakdown exists', () => {
		expect(cursorUsageTabs(usage(spend)).map(({ title }) => title)).toEqual(['Summary']);
		const withModels = usage({
			...spend,
			models: [
				{
					$typeName: 'aiserver.v1.GetAggregatedUsageEventsResponse.ModelUsageAggregation',
					modelIntent: 'cursor-grok-4.6',
					inputTokens: 100n,
					outputTokens: 20n,
					cacheWriteTokens: 0n,
					cacheReadTokens: 0n,
					totalCents: 50,
					requestCost: 0,
					tier: 0,
				},
			],
		});
		const tabs = cursorUsageTabs(withModels);
		expect(tabs.map(({ title }) => title)).toEqual(['Summary', 'Models']);
		expect(cursorUsageTabStrip(tabs, 'models')).toEqual([
			{ title: 'Summary', active: false },
			{ title: 'Models', active: true },
		]);
		expect(cursorUsageFooter(tabs.length)).toContain('tab switch view');
	});

	test('honours configured cancel and Tab bindings plus direct refresh keys', () => {
		const bindings = {
			matches: (data: string, id: string) =>
				(id === 'tui.select.cancel' && data === 'ctrl+x') ||
				(id === 'tui.input.tab' && data === 'ctrl+t'),
		};
		expect(cursorUsagePaneKey('ctrl+x', bindings)).toBe('close');
		expect(cursorUsagePaneKey('ctrl+t', bindings)).toBe('next-tab');
		expect(cursorUsagePaneKey('r', bindings)).toBe('refetch');
		expect(cursorUsagePaneKey('q', bindings)).toBe('close');
		expect(cursorUsagePaneKey('x', bindings)).toBeUndefined();
	});
});

describe('Cursor usage pane loads', () => {
	interface Pending {
		readonly signal: AbortSignal;
		readonly answer: (state: CursorUsage) => void;
	}

	function harness() {
		const applied: CursorUsageState[] = [];
		const pending: Pending[] = [];
		const loads = createUsageLoads(
			(signal) =>
				new Promise((resolve) => {
					pending.push({ signal, answer: (state) => resolve(ok(state)) });
				}),
			(state) => applied.push(state),
		);
		return { applied, pending, loads };
	}

	test('cancels superseded reads so stale data cannot repaint', async () => {
		const { applied, pending, loads } = harness();
		const first = loads.refresh();
		const second = loads.refresh();
		expect(pending[0]?.signal.aborted).toBe(true);
		pending[1]?.answer(usage(spend));
		pending[0]?.answer(usage());
		await Promise.all([first, second]);
		expect(applied.filter(({ type }) => type === 'loaded')).toEqual([
			{ type: 'loaded', usage: usage(spend) },
		]);
	});

	test('turns a failed read into a named error state', async () => {
		const applied: CursorUsageState[] = [];
		const loads = createUsageLoads(
			async () => err({ kind: 'transient', method: 'GetMe', message: 'slow' }),
			(state) => applied.push(state),
		);
		await loads.refresh();
		expect(applied.at(-1)).toEqual({ type: 'error', message: 'GetMe failed: slow' });
	});
});
