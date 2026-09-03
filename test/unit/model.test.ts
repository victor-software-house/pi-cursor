import { describe, expect, test } from 'bun:test';
import { resolveRequestedModel } from '@cursor/model';

describe('Cursor requested model', () => {
	test('maps an OpenAI effort selection to model parameters', () => {
		expect(
			resolveRequestedModel(
				{ id: 'gpt-5.6-sol', thinkingLevelMap: { medium: 'gpt-5.6-sol-medium' } },
				{ maxMode: true, reasoning: 'medium' },
			),
		).toEqual({
			modelId: 'gpt-5.6-sol',
			maxMode: true,
			parameters: [
				{ id: 'context', value: '272k' },
				{ id: 'reasoning', value: 'medium' },
				{ id: 'fast', value: 'false' },
			],
		});
	});

	test('uses a catalog-selected Max Mode context', () => {
		expect(
			resolveRequestedModel(
				{ id: 'gpt-5.6-sol', thinkingLevelMap: { high: 'gpt-5.6-sol-high' } },
				{ maxMode: true, reasoning: 'high', context: '1m' },
			),
		).toEqual({
			modelId: 'gpt-5.6-sol',
			maxMode: true,
			parameters: [
				{ id: 'context', value: '1m' },
				{ id: 'reasoning', value: 'high' },
				{ id: 'fast', value: 'false' },
			],
		});
	});

	test('maps a measured Claude thinking selection', () => {
		expect(
			resolveRequestedModel(
				{
					id: 'claude-opus-5-thinking',
					thinkingLevelMap: { high: 'claude-opus-5-thinking-high' },
				},
				{ maxMode: false, reasoning: 'high' },
			),
		).toEqual({
			modelId: 'claude-opus-5',
			maxMode: false,
			parameters: [
				{ id: 'thinking', value: 'true' },
				{ id: 'context', value: '300k' },
				{ id: 'effort', value: 'high' },
				{ id: 'fast', value: 'false' },
			],
		});
	});

	test('replaces the captured Claude context for a catalog-selected variant', () => {
		expect(
			resolveRequestedModel(
				{
					id: 'claude-opus-5-thinking',
					thinkingLevelMap: { high: 'claude-opus-5-thinking-high' },
				},
				{ maxMode: true, reasoning: 'high', context: '1m' },
			),
		).toMatchObject({
			modelId: 'claude-opus-5',
			maxMode: true,
			parameters: [
				{ id: 'context', value: '1m' },
				{ id: 'thinking', value: 'true' },
				{ id: 'effort', value: 'high' },
				{ id: 'fast', value: 'false' },
			],
		});
	});
});
