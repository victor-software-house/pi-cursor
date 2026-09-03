import { describe, expect, test } from 'bun:test';
import { loadCursorUsage } from '@cursor/usage';

const token = process.env['PI_CURSOR_TOKEN'];
const skip = process.env['CI'] !== undefined || token === undefined || token === '';

describe.skipIf(skip)('Cursor usage live', () => {
	test('loads the current account usage without exposing account values', async () => {
		if (token === undefined || token === '') throw new Error('PI_CURSOR_TOKEN is required');
		const result = await loadCursorUsage({ token });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.model.planName).not.toBe('');
		expect(result.value.model.resetLabel).not.toBe('');
		if (result.value.model.kind === 'standard') {
			expect(Number.isFinite(result.value.model.includedTotalPercent)).toBe(true);
			expect(Number.isFinite(result.value.model.onDemand.usedDollars)).toBe(true);
		} else {
			expect(result.value.model.currentCycle.length).toBeGreaterThan(0);
			expect(result.value.model.previousPeriod.length).toBeGreaterThan(0);
		}
	}, 30_000);
});
