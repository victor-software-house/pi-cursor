import { describe, expect, test } from 'bun:test';
import { dispatchCursorCommand, getCursorCompletions } from '@cursor/command';
import type { CursorUsage } from '@cursor/usage';
import type { ExtensionAPI, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
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

function host(mode: 'tui' | 'rpc' | 'json' | 'print', token: string | null = 'token') {
	const notices: { message: string; level?: string }[] = [];
	const outputs: string[] = [];
	const messages: { content: string; level: unknown }[] = [];
	let opened = 0;
	const custom: ExtensionUIContext['custom'] = async <T>() => {
		opened += 1;
		return await Promise.reject<T>(new Error('pane opened'));
	};
	const sendMessage: Pick<ExtensionAPI, 'sendMessage'>['sendMessage'] = (message) => {
		if (typeof message.content !== 'string') throw new Error('Cursor command output must be text');
		messages.push({ content: message.content, level: message.details });
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
			sendMessage,
			writeOutput: (output: string) => outputs.push(output),
		},
		notices,
		outputs,
		messages,
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
		const { ctx, outputs } = host('print');
		await dispatchCursorCommand(ctx, 'usage', { loadUsage: async () => ok(usage) });
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toContain('Pro · Resets Sep 1');
		expect(outputs[0]).toContain('Included');
	});

	test('/cursor usage emits the same summary as a JSON custom message', async () => {
		const { ctx, messages } = host('json');
		await dispatchCursorCommand(ctx, 'usage', { loadUsage: async () => ok(usage) });
		expect(messages).toHaveLength(1);
		expect(messages[0]?.content).toContain('Pro · Resets Sep 1');
		expect(messages[0]?.level).toEqual({ level: 'info' });
	});

	test('/cursor help uses RPC notifications', async () => {
		const { ctx, notices } = host('rpc');
		await dispatchCursorCommand(ctx, 'help');
		expect(notices).toEqual([{ message: 'Usage: /cursor [usage|help]', level: 'info' }]);
	});

	test('missing auth gives an actionable login instruction', async () => {
		const { ctx, outputs } = host('print', null);
		await dispatchCursorCommand(ctx, 'usage', { loadUsage: async () => ok(usage) });
		expect(outputs).toEqual(['Cursor is not signed in. Run /login cursor first.\n']);
	});

	test('unknown subcommands are rejected with the valid command shape', async () => {
		const { ctx, outputs } = host('print');
		await dispatchCursorCommand(ctx, 'accounts', { loadUsage: async () => ok(usage) });
		expect(outputs[0]).toContain('Unknown /cursor subcommand: accounts.');
		expect(outputs[0]).toContain('Usage: /cursor [usage|help]');
	});
});
