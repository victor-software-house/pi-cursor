import { registerCursorCommand } from '@cursor/command';
import { loadCursorMachineIdentity } from '@cursor/identity';
import { createCursorProvider } from '@cursor/provider';
import { loadCursorSettings } from '@cursor/settings';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

/** Register Cursor as a native, dynamically discovered Pi inference provider. */
export default async function cursorInference(pi: ExtensionAPI): Promise<void> {
	const settings = loadCursorSettings();
	const identity = await loadCursorMachineIdentity(getAgentDir());
	const runtime = createCursorProvider(identity);
	pi.registerProvider(runtime.provider);
	registerCursorCommand(pi);

	if (identity.machineIdSource === 'fallback' || settings.warning !== undefined) {
		pi.on('session_start', (_event, ctx) => {
			if (identity.machineIdSource === 'fallback') {
				ctx.ui.notify(
					'Cursor could not derive the host machine id; using a persisted fallback identity.',
					'warning',
				);
			}
			if (settings.warning !== undefined) ctx.ui.notify(settings.warning, 'warning');
		});
	}
	pi.on('session_shutdown', async () => {
		await runtime.shutdown();
	});
}
