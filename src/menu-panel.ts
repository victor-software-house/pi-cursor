import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { MenuItem } from '@victor-software-house/pi-components';
import { MenuPanel } from '@victor-software-house/pi-components';

export type CursorMenuAction = 'usage' | 'settings';

const items: readonly MenuItem[] = [
	{
		value: 'usage',
		label: 'Usage',
		description: 'Account limits, spend, and per-model usage',
	},
	{
		value: 'settings',
		label: 'Settings',
		description: 'Reconciliation safety and persisted diagnostics',
	},
];

export async function openCursorMenu(
	ui: Pick<ExtensionUIContext, 'custom'>,
): Promise<CursorMenuAction | undefined> {
	return ui.custom<CursorMenuAction | undefined>((_tui, theme, keybindings, done) => {
		const panel = new MenuPanel([...items], theme, keybindings, {
			title: 'Cursor',
			subtitle: 'managed inference',
			maxVisible: items.length,
			minLabelWidth: 12,
			maxLabelWidth: 16,
			searchLabel: 'action',
		});
		panel.onSelect = (value) => {
			if (value === 'usage' || value === 'settings') done(value);
		};
		panel.onCancel = () => done(undefined);
		return panel;
	});
}
