import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	applyCursorSettings,
	DEFAULT_CURSOR_SETTINGS,
	getCursorSettings,
	loadCursorSettings,
	parseCursorSettings,
	saveCursorSettings,
	summarizeCursorSettings,
} from '@cursor/settings';

afterEach(() => {
	applyCursorSettings(DEFAULT_CURSOR_SETTINGS);
});

describe('Cursor settings', () => {
	test('defaults strict reconciliation on and persisted diagnostics off', () => {
		expect(DEFAULT_CURSOR_SETTINGS).toEqual({
			strictReconciliation: true,
			diagnostics: false,
		});
		expect(parseCursorSettings({})).toEqual(DEFAULT_CURSOR_SETTINGS);
		expect(() => parseCursorSettings({ diagnostics: 'yes' })).toThrow(
			'diagnostics must be a boolean',
		);
	});

	test('persists validated settings with owner-only permissions and reloads them', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'pi-cursor-settings-'));
		const path = join(directory, 'settings.json');
		try {
			saveCursorSettings({ strictReconciliation: false, diagnostics: true }, path);
			expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
				strictReconciliation: false,
				diagnostics: true,
			});
			expect((await stat(path)).mode & 0o777).toBe(0o600);
			applyCursorSettings(DEFAULT_CURSOR_SETTINGS);
			expect(loadCursorSettings(path)).toEqual({
				settings: { strictReconciliation: false, diagnostics: true },
			});
			expect(getCursorSettings()).toEqual({
				strictReconciliation: false,
				diagnostics: true,
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('recovers from missing or invalid files with defaults and a visible warning only for corruption', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'pi-cursor-settings-'));
		const path = join(directory, 'settings.json');
		try {
			expect(loadCursorSettings(path)).toEqual({ settings: DEFAULT_CURSOR_SETTINGS });
			await writeFile(path, '{broken', 'utf8');
			const invalid = loadCursorSettings(path);
			expect(invalid.settings).toEqual(DEFAULT_CURSOR_SETTINGS);
			expect(invalid.warning).toContain('Cursor ignored invalid settings');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('states that thinking preservation is always on', () => {
		expect(summarizeCursorSettings()).toContain('thinking preservation: always on');
	});
});
