import { loadCursorMachineIdentity } from '@cursor/identity';
import { createCursorProvider } from '@cursor/provider';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

/** Register Cursor as a native, dynamically discovered Pi inference provider. */
export default async function cursorInference(pi: ExtensionAPI): Promise<void> {
	const identity = await loadCursorMachineIdentity(getAgentDir());
	const runtime = createCursorProvider(identity);
	pi.registerProvider(runtime.provider);

	if (identity.machineIdSource === 'fallback') {
		pi.on('session_start', (_event, ctx) => {
			ctx.ui.notify(
				'Cursor could not derive the host machine id; using a persisted fallback identity.',
				'warning',
			);
		});
	}
	pi.on('session_shutdown', async () => {
		await runtime.shutdown();
	});
}
