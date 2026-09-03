import { describe, expect, test } from 'bun:test';
import { dispatchCursorCommand, getCursorCompletions } from '@cursor/command';
import type { CursorUsage } from '@cursor/usage';
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { ok } from '@victor-software-house/pi-type-kit';

const usage: CursorUsage = {
	model: {
		kind: 'standard',
		planName: 'Pro',
		resetLabel: 'Resets Sep 1',
		includedTotalPercent: 42,
		includedAutoPercent: 18,
		includedApiPercent: 1,
		onDemand: { kind: 'disabled', usedDollars: 0 },
	},
	misses: [],
};

function host(mode: 'tui' | 'print', token: string | null = 'token') {
	const notices: { message: string; level?: string }[] = [];
	let opened = 0;
	const custom: ExtensionUIContext['custom'] = async <T>() => {
		opened += 1;
		return await Promise.reject<T>(new Error('pane opened'));
	};
	return {
		ctx: {
			mode,
			ui: {
				custom,
				notify: (message: string, level?: 'info' | 'warning' | 'error') => {
					notices.push(level === undefined ? { message } : { message, level });
				},
			},
			modelRegistry: {
				getProviderAuth: async () =>
					token === null ? undefined : { auth: { apiKey: token }, source: 'OAuth' },
			},
		},
		notices,
		opened: () => opened,
	};
}

describe('/cursor command', () => {
	test('teaches usage and help through autocomplete', () => {
		expect(getCursorCompletions('')?.map(({ value }) => value)).toEqual(['usage', 'help']);
		expect(getCursorCompletions('u')?.map(({ value }) => value)).toEqual(['usage']);
		expect(getCursorCompletions('usage extra')).toBeNull();
	});

	test('bare /cursor opens the usage pane in TUI mode', async () => {
		const { ctx, opened } = host('tui');
		let failure: unknown;
		try {
			await dispatchCursorCommand(ctx, '', { loadUsage: async () => ok(usage) });
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(Error);
		expect(failure instanceof Error ? failure.message : '').toBe('pane opened');
		expect(opened()).toBe(1);
	});

	test('/cursor usage prints the same summary outside the TUI', async () => {
		const { ctx, notices } = host('print');
		await dispatchCursorCommand(ctx, 'usage', { loadUsage: async () => ok(usage) });
		expect(notices).toHaveLength(1);
		expect(notices[0]?.message).toContain('Pro · Resets Sep 1');
		expect(notices[0]?.message).toContain('Included');
	});

	test('missing auth gives an actionable login instruction', async () => {
		const { ctx, notices } = host('print', null);
		await dispatchCursorCommand(ctx, 'usage', { loadUsage: async () => ok(usage) });
		expect(notices).toEqual([
			{ message: 'Cursor is not signed in. Run /login cursor first.', level: 'warning' },
		]);
	});

	test('unknown subcommands are rejected with the valid command shape', async () => {
		const { ctx, notices } = host('print');
		await dispatchCursorCommand(ctx, 'accounts', { loadUsage: async () => ok(usage) });
		expect(notices[0]?.level).toBe('error');
		expect(notices[0]?.message).toContain('Usage: /cursor [usage|help]');
	});
});
