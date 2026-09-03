import {
	cursorSettingsPath,
	getCursorSettings,
	saveCursorSettings,
	summarizeCursorSettings,
} from '@cursor/settings';
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { getSettingsListTheme } from '@earendil-works/pi-coding-agent';
import type { SettingItem } from '@earendil-works/pi-tui';
import { createSettingsPanel, refreshDescription } from '@victor-software-house/pi-components';

const descriptions = {
	strictReconciliation: {
		on: 'Fail before tool execution when streamed and final response copies disagree.',
		off: 'Accept final content without streamed/final equality checks; stream validity still applies.',
	},
	diagnostics: {
		on: 'Persist response metadata and census data; about 0.6 kB baseline per turn, more with side channels.',
		off: 'Add no Cursor diagnostic data to assistant session messages.',
	},
} as const;

function settingsItems(): SettingItem[] {
	const settings = getCursorSettings();
	return [
		{
			id: 'strictReconciliation',
			label: 'Strict reconciliation',
			description: descriptions.strictReconciliation[settings.strictReconciliation ? 'on' : 'off'],
			currentValue: settings.strictReconciliation ? 'on' : 'off',
			values: ['on', 'off'],
		},
		{
			id: 'diagnostics',
			label: 'Persist diagnostics',
			description: descriptions.diagnostics[settings.diagnostics ? 'on' : 'off'],
			currentValue: settings.diagnostics ? 'on' : 'off',
			values: ['on', 'off'],
		},
	];
}

export interface CursorSettingsPanelHost {
	readonly mode: 'tui' | 'rpc' | 'json' | 'print';
	readonly ui: Pick<ExtensionUIContext, 'custom' | 'notify'>;
}

export async function openCursorSettingsPanel(
	ctx: CursorSettingsPanelHost,
	emit: (message: string, level: 'info' | 'warning' | 'error') => void,
): Promise<void> {
	if (ctx.mode !== 'tui') {
		emit(`${summarizeCursorSettings()}\nconfig: ${cursorSettingsPath()}`, 'info');
		return;
	}

	const items = settingsItems();
	await ctx.ui.custom((tui, theme, _keybindings, done) =>
		createSettingsPanel(tui, theme, done, {
			title: 'Cursor Settings',
			configPath: cursorSettingsPath(),
			items,
			settingsListTheme: getSettingsListTheme(),
			onChange: (id, newValue) => {
				const item = items.find((candidate) => candidate.id === id);
				if (item === undefined || (id !== 'strictReconciliation' && id !== 'diagnostics')) return;
				item.currentValue = newValue;
				refreshDescription(item, descriptions[id]);
				try {
					saveCursorSettings({ ...getCursorSettings(), [id]: newValue === 'on' });
				} catch (error) {
					ctx.ui.notify(
						`Failed to save Cursor settings: ${error instanceof Error ? error.message : String(error)}`,
						'error',
					);
				}
			},
		}),
	);
}
