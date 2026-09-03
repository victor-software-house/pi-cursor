import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { isRecord } from '@victor-software-house/pi-type-kit';

export interface CursorSettings {
	/** Fail the turn when streamed and final response copies disagree structurally. */
	readonly strictReconciliation: boolean;
	/** Persist response side-channel details and a payload-free reconciliation census. */
	readonly diagnostics: boolean;
}

export interface CursorSettingsLoadResult {
	readonly settings: CursorSettings;
	readonly warning?: string;
}

export const DEFAULT_CURSOR_SETTINGS: CursorSettings = {
	strictReconciliation: true,
	diagnostics: false,
};

let current: CursorSettings = { ...DEFAULT_CURSOR_SETTINGS };

export function cursorSettingsPath(agentDir = getAgentDir()): string {
	return join(agentDir, 'pi-cursor.json');
}

export function getCursorSettings(): CursorSettings {
	return current;
}

export function applyCursorSettings(settings: CursorSettings): CursorSettings {
	current = { ...settings };
	return current;
}

export function parseCursorSettings(value: unknown): CursorSettings {
	if (!isRecord(value)) throw new Error('settings must be a JSON object');
	const strictReconciliation = value['strictReconciliation'];
	const diagnostics = value['diagnostics'];
	if (strictReconciliation !== undefined && typeof strictReconciliation !== 'boolean') {
		throw new Error('strictReconciliation must be a boolean');
	}
	if (diagnostics !== undefined && typeof diagnostics !== 'boolean') {
		throw new Error('diagnostics must be a boolean');
	}
	return {
		strictReconciliation: strictReconciliation ?? DEFAULT_CURSOR_SETTINGS.strictReconciliation,
		diagnostics: diagnostics ?? DEFAULT_CURSOR_SETTINGS.diagnostics,
	};
}

export function loadCursorSettings(path = cursorSettingsPath()): CursorSettingsLoadResult {
	try {
		return {
			settings: applyCursorSettings(parseCursorSettings(JSON.parse(readFileSync(path, 'utf8')))),
		};
	} catch (error) {
		const defaults = applyCursorSettings({ ...DEFAULT_CURSOR_SETTINGS });
		if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
			return { settings: defaults };
		}
		return {
			settings: defaults,
			warning: `Cursor ignored invalid settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function saveCursorSettings(
	settings: CursorSettings,
	path = cursorSettingsPath(),
): CursorSettings {
	const next = applyCursorSettings(parseCursorSettings(settings));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
	chmodSync(path, 0o600);
	return next;
}

export function summarizeCursorSettings(settings = getCursorSettings()): string {
	return [
		`strict reconciliation: ${settings.strictReconciliation ? 'on' : 'off'} — ${
			settings.strictReconciliation
				? 'fail when streamed and final response copies disagree'
				: 'accept the final response without cross-copy equality checks'
		}`,
		`persist diagnostics: ${settings.diagnostics ? 'on' : 'off'} — ${
			settings.diagnostics
				? 'store response metadata and reconciliation census data in assistant session messages'
				: 'add no Cursor diagnostics to assistant session messages'
		}`,
		'thinking preservation: always on — empty or redacted final reasoning cannot erase streamed thinking',
	].join('\n');
}
