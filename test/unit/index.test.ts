import { describe, expect, test } from 'bun:test';
import cursorInference from '@cursor';

describe('extension entry', () => {
	test('is a function taking the Pi extension API', () => {
		expect(typeof cursorInference).toBe('function');
		expect(cursorInference.length).toBe(1);
	});
});
