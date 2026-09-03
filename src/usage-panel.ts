import type { DashboardError } from '@cursor/dashboard';
import type { CursorUsage } from '@cursor/usage';
import type { UsageTab } from '@cursor/usage-view';
import { cursorUsageTabs, formatCursorUsageSummary, usageHeadline } from '@cursor/usage-view';
import type { KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent';
import { DynamicBorder } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { Loader, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import type { Result } from '@victor-software-house/pi-type-kit';
import { match } from 'ts-pattern';

export type CursorUsageState =
	| { readonly type: 'loading' }
	| { readonly type: 'error'; readonly message: string }
	| { readonly type: 'loaded'; readonly usage: CursorUsage };

export type CursorUsageKey = 'close' | 'refetch' | 'next-tab' | undefined;

export function cursorUsagePaneKey(
	data: string,
	keybindings?: Pick<KeybindingsManager, 'matches'>,
): CursorUsageKey {
	if (keybindings?.matches(data, 'tui.select.cancel') === true || matchesKey(data, 'escape')) {
		return 'close';
	}
	if (keybindings?.matches(data, 'tui.input.tab') === true || matchesKey(data, 'tab')) {
		return 'next-tab';
	}
	if (data === 'q') return 'close';
	if (data === 'r') return 'refetch';
	return undefined;
}

export function cursorUsageFooter(tabCount: number): string {
	const hints = tabCount > 1 ? ['tab switch view'] : [];
	hints.push('r refresh', 'q/Esc close');
	return hints.join('  ');
}

export function cursorUsageTabStrip(
	tabs: readonly UsageTab[],
	activeId: string,
): { readonly title: string; readonly active: boolean }[] {
	return tabs.map((tab) => ({ title: tab.title, active: tab.id === activeId }));
}

export function cursorUsageRows(
	theme: Pick<Theme, 'fg' | 'bold'>,
	usage: CursorUsage,
	tabId: string,
	maxWidth: number,
): string[] {
	const missed = new Set(usage.misses.map((miss) => `  ${miss.method} failed: ${miss.message}`));
	const headline = usageHeadline(usage);
	const rows = [''];
	for (const text of formatCursorUsageSummary(usage, tabId)) {
		const painted = missed.has(text)
			? theme.fg('error', text)
			: text === headline
				? theme.fg('accent', theme.bold(text))
				: theme.fg('text', text);
		rows.push(truncateToWidth(`  ${painted}`, maxWidth));
	}
	return rows;
}

export type ReadUsage = (signal: AbortSignal) => Promise<Result<CursorUsage, DashboardError>>;

export interface UsageLoads {
	readonly refresh: () => Promise<void>;
	readonly close: () => void;
}

export function createUsageLoads(
	read: ReadUsage,
	apply: (state: CursorUsageState) => void,
): UsageLoads {
	const closed = new AbortController();
	let current: AbortController | undefined;
	return {
		refresh: async () => {
			if (closed.signal.aborted) return;
			current?.abort();
			current = new AbortController();
			const signal = AbortSignal.any([closed.signal, current.signal]);
			apply({ type: 'loading' });
			const result = await read(signal);
			if (signal.aborted) return;
			apply(
				match(result)
					.with({ ok: true }, (self) => ({ type: 'loaded', usage: self.value }) as const)
					.with(
						{ ok: false },
						(self) =>
							({
								type: 'error',
								message: `${self.error.method} failed: ${self.error.message}`,
							}) as const,
					)
					.exhaustive(),
			);
		},
		close: () => {
			closed.abort();
			current?.abort();
		},
	};
}

export class CursorUsageComponent implements Component {
	private state: CursorUsageState = { type: 'loading' };
	private loader: Loader | null = null;
	private activeTabId = 'summary';
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly keybindings: KeybindingsManager;
	private readonly onClose: () => void;
	private readonly onRefetch: () => void;

	constructor(
		theme: Theme,
		tui: TUI,
		keybindings: KeybindingsManager,
		onClose: () => void,
		onRefetch: () => void,
	) {
		this.theme = theme;
		this.tui = tui;
		this.keybindings = keybindings;
		this.onClose = onClose;
		this.onRefetch = onRefetch;
		this.startLoader();
	}

	setState(state: CursorUsageState): void {
		this.stopLoader();
		this.state = state;
		match(state)
			.with({ type: 'loading' }, () => {
				this.startLoader();
			})
			.with({ type: 'error' }, () => {})
			.with({ type: 'loaded' }, (self) => {
				const tabs = cursorUsageTabs(self.usage);
				if (!tabs.some((tab) => tab.id === this.activeTabId)) this.activeTabId = tabs[0].id;
			})
			.exhaustive();
	}

	handleInput(data: string): void {
		match(cursorUsagePaneKey(data, this.keybindings))
			.with('close', () => {
				this.onClose();
			})
			.with('refetch', () => {
				this.onRefetch();
			})
			.with('next-tab', () => {
				this.cycleTab();
			})
			.with(undefined, () => {})
			.exhaustive();
	}

	render(width: number): string[] {
		const maxWidth = Math.max(20, width);
		const border = new DynamicBorder((value: string) => this.theme.fg('border', value));
		const lines = [...border.render(maxWidth)];
		lines.push(
			truncateToWidth(` ${this.theme.fg('accent', this.theme.bold('Cursor usage'))}`, maxWidth),
		);

		const body = match(this.state)
			.with({ type: 'loading' }, () => ({
				tabCount: 1,
				lines: this.loader?.render(maxWidth) ?? [this.theme.fg('muted', '  Fetching usage…')],
			}))
			.with({ type: 'error' }, (self) => ({
				tabCount: 1,
				lines: ['', truncateToWidth(`  ${this.theme.fg('error', self.message)}`, maxWidth)],
			}))
			.with({ type: 'loaded' }, (self) => {
				const tabs = cursorUsageTabs(self.usage);
				return {
					tabCount: tabs.length,
					lines: [
						...(tabs.length > 1 ? ['', this.renderTabStrip(tabs, maxWidth)] : []),
						...cursorUsageRows(this.theme, self.usage, this.activeTabId, maxWidth),
					],
				};
			})
			.exhaustive();
		lines.push(...body.lines, '');
		lines.push(
			truncateToWidth(`  ${this.theme.fg('dim', cursorUsageFooter(body.tabCount))}`, maxWidth),
		);
		lines.push(...border.render(maxWidth));
		return lines;
	}

	invalidate(): void {}

	destroy(): void {
		this.stopLoader();
	}

	private cycleTab(): void {
		if (this.state.type !== 'loaded') return;
		const tabs = cursorUsageTabs(this.state.usage);
		if (tabs.length < 2) return;
		const index = tabs.findIndex((tab) => tab.id === this.activeTabId);
		this.activeTabId = tabs[(index + 1) % tabs.length]?.id ?? tabs[0].id;
		this.tui.requestRender();
	}

	private renderTabStrip(tabs: readonly UsageTab[], maxWidth: number): string {
		const strip = cursorUsageTabStrip(tabs, this.activeTabId)
			.map((tab) =>
				tab.active
					? this.theme.fg('accent', this.theme.bold(tab.title))
					: this.theme.fg('dim', tab.title),
			)
			.join(this.theme.fg('dim', ' · '));
		return truncateToWidth(`  ${strip}`, maxWidth);
	}

	private startLoader(): void {
		this.loader = new Loader(
			this.tui,
			(value: string) => this.theme.fg('accent', value),
			(value: string) => this.theme.fg('muted', value),
			'Fetching usage…',
		);
	}

	private stopLoader(): void {
		this.loader?.stop();
		this.loader = null;
	}
}
