import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Cursor as a plain inference provider for Pi.
 *
 * Slice 0: the extension loads and registers nothing. Provider registration arrives with the
 * protocol, transport, and auth slices (docs/plan.md).
 */
export default function cursorInference(_pi: ExtensionAPI): void {}
