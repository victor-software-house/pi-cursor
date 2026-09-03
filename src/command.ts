import { stderr } from 'node:process';
import { loadCursorUsage } from '@cursor/usage';
import { CursorUsageComponent, createUsageLoads } from '@cursor/usage-panel';
import { formatCursorUsageSummary } from '@cursor/usage-view';
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionUIContext,
	ModelRegistry,
} from '@earendil-works/pi-coding-agent';
import type { AutocompleteItem } from '@earendil-works/pi-tui';

const command = 'cursor';
const usage = 'Usage: /cursor [usage|help]';
const completions: AutocompleteItem[] = [
	{ value: 'usage', label: 'usage', description: 'open the Cursor usage pane' },
	{ value: 'help', label: 'help', description: 'show command usage' },
];

const outputType = 'cursor-command-output';

export interface CursorCommandHost {
	readonly mode: ExtensionCommandContext['mode'];
	readonly ui: Pick<ExtensionUIContext, 'custom' | 'notify'>;
	readonly modelRegistry: Pick<ModelRegistry, 'getProviderAuth'>;
	readonly sendMessage: Pick<ExtensionAPI, 'sendMessage'>['sendMessage'];
	readonly writeOutput: (output: string) => void;
}

export interface CursorCommandDependencies {
	readonly loadUsage?: typeof loadCursorUsage;
}

export function getCursorCompletions(prefix: string): AutocompleteItem[] | null {
	const normalized = prefix.trimStart();
	if (/\s/u.test(normalized)) return null;
	const matches = completions.filter((item) => item.value.startsWith(normalized));
	return matches.length === 0 ? null : matches;
}

function emitCommandOutput(
	ctx: CursorCommandHost,
	message: string,
	level: 'info' | 'warning' | 'error',
): void {
	if (ctx.mode === 'print') {
		ctx.writeOutput(`${message}\n`);
		return;
	}
	if (ctx.mode === 'json') {
		ctx.sendMessage({
			customType: outputType,
			content: message,
			display: true,
			details: { level },
		});
		return;
	}
	ctx.ui.notify(message, level);
}

async function tokenForUsage(ctx: CursorCommandHost): Promise<string | undefined> {
	try {
		const resolved = await ctx.modelRegistry.getProviderAuth('cursor');
		const token = resolved?.auth.apiKey;
		if (token !== undefined && token !== '') return token;
	} catch (error) {
		emitCommandOutput(
			ctx,
			`Cursor authentication failed: ${error instanceof Error ? error.message : String(error)}`,
			'error',
		);
		return undefined;
	}
	emitCommandOutput(ctx, 'Cursor is not signed in. Run /login cursor first.', 'warning');
	return undefined;
}

async function showCursorUsage(
	ctx: CursorCommandHost,
	deps: CursorCommandDependencies,
): Promise<void> {
	const token = await tokenForUsage(ctx);
	if (token === undefined) return;
	const loadUsage = deps.loadUsage ?? loadCursorUsage;

	if (ctx.mode !== 'tui') {
		const result = await loadUsage({ token });
		if (!result.ok) {
			emitCommandOutput(ctx, `${result.error.method} failed: ${result.error.message}`, 'error');
			return;
		}
		emitCommandOutput(ctx, formatCursorUsageSummary(result.value).join('\n'), 'info');
		return;
	}

	await ctx.ui.custom<null>((tui, theme, keybindings, done) => {
		let loads: ReturnType<typeof createUsageLoads>;
		const component = new CursorUsageComponent(
			theme,
			tui,
			keybindings,
			() => {
				loads.close();
				done(null);
			},
			() => {
				void loads.refresh();
			},
		);
		loads = createUsageLoads(
			(signal) => loadUsage({ token, signal }),
			(state) => {
				component.setState(state);
				tui.requestRender();
			},
		);
		void loads.refresh();

		return {
			render: (width) => component.render(width),
			invalidate: () => component.invalidate(),
			handleInput: (data) => component.handleInput(data),
			dispose: () => {
				loads.close();
				component.destroy();
			},
		};
	});
}

export async function dispatchCursorCommand(
	ctx: CursorCommandHost,
	args: string,
	deps: CursorCommandDependencies = {},
): Promise<void> {
	const normalized = args.trim().toLowerCase();
	if (normalized === '' || normalized === 'usage') {
		await showCursorUsage(ctx, deps);
		return;
	}
	if (normalized === 'help') {
		emitCommandOutput(ctx, usage, 'info');
		return;
	}
	emitCommandOutput(ctx, `Unknown /cursor subcommand: ${normalized}.\n${usage}`, 'error');
}

export function registerCursorCommand(
	pi: Pick<ExtensionAPI, 'registerCommand' | 'sendMessage'>,
): void {
	pi.registerCommand(command, {
		description: 'Open Cursor account usage and per-model spend',
		getArgumentCompletions: getCursorCompletions,
		handler: async (args, ctx) => {
			await dispatchCursorCommand(
				{ ...ctx, sendMessage: pi.sendMessage, writeOutput: (output) => stderr.write(output) },
				args,
			);
		},
	});
}
