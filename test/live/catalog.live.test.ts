import { describe, expect, test } from 'bun:test';
import { discoverCursorModels } from '@cursor/catalog';

const token = process.env['PI_CURSOR_TOKEN'];
const skip = process.env['CI'] === 'true' || token === undefined || token === '';

describe('Cursor catalog live', () => {
	test.skipIf(skip)(
		'discovers selectable models through all three catalog surfaces',
		async () => {
			if (token === undefined || token === '') throw new Error('PI_CURSOR_TOKEN is required');
			const models = await discoverCursorModels({
				backendUrl: 'https://api2.cursor.sh',
				token,
				force: true,
			});
			expect(models.length).toBeGreaterThan(0);
			for (const model of models) {
				expect(model.provider).toBe('cursor');
				expect(model.api).toBe('cursor-inference');
				expect(model.id).not.toBe('');
			}
		},
		30_000,
	);
});
