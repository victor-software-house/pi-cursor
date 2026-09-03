import { describe, expect, test } from 'bun:test';
import { create } from '@bufbuild/protobuf';
import { catalogModels } from '@cursor/catalog';
import {
	GetDefaultModelForCliResponseSchema,
	GetUsableModelsResponseSchema,
	ModelDetailsSchema,
} from '@cursor/gen/agent/v1/catalog_pb';
import {
	AvailableModelsResponse_AvailableModelSchema,
	AvailableModelsResponseSchema,
} from '@cursor/gen/aiserver/v1/catalog_pb';

const base = create(AvailableModelsResponseSchema, {
	models: [create(AvailableModelsResponse_AvailableModelSchema, { name: 'gpt-5.6-sol' })],
});

const usable = create(GetUsableModelsResponseSchema, {
	models: [
		create(ModelDetailsSchema, {
			modelId: 'gpt-5.6-sol-medium',
			displayName: 'GPT-5.6 Sol Medium',
		}),
		create(ModelDetailsSchema, {
			modelId: 'gpt-5.6-sol-high',
			displayName: 'GPT-5.6 Sol High',
		}),
		create(ModelDetailsSchema, { modelId: 'composer-2.5', displayName: 'Composer 2.5' }),
	],
});

describe('Cursor catalog', () => {
	test('collapses effort selections into Pi thinking levels', () => {
		const models = catalogModels(
			base,
			usable,
			create(GetDefaultModelForCliResponseSchema, { model: usable.models[0] }),
			'https://api2.cursor.sh',
		);
		expect(models).toHaveLength(2);
		expect(models[0]).toMatchObject({
			id: 'gpt-5.6-sol',
			name: 'GPT-5.6 Sol',
			provider: 'cursor',
			api: 'cursor-inference',
			reasoning: true,
			thinkingLevelMap: {
				medium: 'gpt-5.6-sol-medium',
				high: 'gpt-5.6-sol-high',
			},
		});
		expect(models[1]).toMatchObject({ id: 'composer-2.5', reasoning: false });
	});

	test('uses measured Grok capabilities without inventing a redundant Max row', () => {
		const grokBase = create(AvailableModelsResponseSchema, {
			models: [
				create(AvailableModelsResponse_AvailableModelSchema, {
					name: 'grok-4.6',
					clientDisplayName: 'Cursor Grok 4.6',
					supportsThinking: true,
					supportsImages: true,
					supportsMaxMode: true,
					supportsNonMaxMode: true,
					contextTokenLimit: 256_000,
					contextTokenLimitForMaxMode: 256_000,
					tooltipData: { markdownContent: '256k context window' },
					tooltipDataForMaxMode: { markdownContent: '256k context window' },
					variants: [
						{
							parameterValues: [
								{ id: 'effort', value: 'xhigh' },
								{ id: 'fast', value: 'false' },
							],
							displayName: 'Cursor Grok 4.6 Extra High',
							isDefaultMaxConfig: true,
							isDefaultNonMaxConfig: true,
							legacySlug: 'cursor-grok-4.6-xhigh',
						},
					],
					legacySlugs: ['cursor-grok-4.6-high', 'cursor-grok-4.6-xhigh'],
				}),
			],
		});
		const grokUsable = create(GetUsableModelsResponseSchema, {
			models: [
				create(ModelDetailsSchema, {
					modelId: 'cursor-grok-4.6-high',
					displayName: 'Cursor Grok 4.6 High',
				}),
				create(ModelDetailsSchema, {
					modelId: 'cursor-grok-4.6-xhigh',
					displayName: 'Cursor Grok 4.6 Extra High',
				}),
			],
		});
		const models = catalogModels(
			grokBase,
			grokUsable,
			create(GetDefaultModelForCliResponseSchema, { model: grokUsable.models[1] }),
			'https://api2.cursor.sh',
		);
		expect(models).toHaveLength(1);
		expect(models[0]).toMatchObject({
			id: 'cursor-grok-4.6',
			name: 'Cursor Grok 4.6',
			reasoning: true,
			input: ['text', 'image'],
			contextWindow: 256_000,
		});
		expect(models[0]?.samplingParams).toBeUndefined();
	});

	test('splits a catalog-distinct GPT Max Mode row with its measured context', () => {
		const gptBase = create(AvailableModelsResponseSchema, {
			models: [
				create(AvailableModelsResponse_AvailableModelSchema, {
					name: 'gpt-5.6-sol',
					clientDisplayName: 'GPT-5.6 Sol',
					supportsThinking: true,
					supportsImages: true,
					supportsMaxMode: true,
					supportsNonMaxMode: true,
					contextTokenLimit: 272_000,
					contextTokenLimitForMaxMode: 1_000_000,
					variants: [
						{
							parameterValues: [
								{ id: 'context', value: '272k' },
								{ id: 'reasoning', value: 'medium' },
							],
							displayName: 'GPT-5.6 Sol',
							isDefaultNonMaxConfig: true,
							legacySlug: 'gpt-5.6-sol-medium',
						},
						{
							parameterValues: [
								{ id: 'context', value: '1m' },
								{ id: 'reasoning', value: 'medium' },
							],
							displayName: 'GPT-5.6 Sol',
							isMaxMode: true,
							isDefaultMaxConfig: true,
							legacySlug: 'gpt-5.6-sol-medium',
						},
					],
				}),
			],
		});
		const models = catalogModels(
			gptBase,
			usable,
			create(GetDefaultModelForCliResponseSchema, { model: usable.models[0] }),
			'https://api2.cursor.sh',
		);
		expect(models.slice(0, 2)).toMatchObject([
			{
				id: 'gpt-5.6-sol',
				contextWindow: 272_000,
				samplingParams: { cursorContext: '272k' },
			},
			{
				id: 'gpt-5.6-sol-max',
				name: 'GPT-5.6 Sol Max',
				contextWindow: 1_000_000,
				samplingParams: { cursorMaxMode: true, cursorContext: '1m' },
			},
		]);
	});

	test('retains conservative metadata for an unmatched usable family', () => {
		const unknown = create(GetUsableModelsResponseSchema, {
			models: [create(ModelDetailsSchema, { modelId: 'unknown-model', displayName: 'Unknown' })],
		});
		const models = catalogModels(
			base,
			unknown,
			create(GetDefaultModelForCliResponseSchema, { model: unknown.models[0] }),
			'https://api2.cursor.sh',
		);
		expect(models).toMatchObject([
			{
				id: 'unknown-model',
				contextWindow: 200_000,
				input: ['text', 'image'],
			},
		]);
		expect(models[0]?.samplingParams).toBeUndefined();
	});

	test('rejects an unavailable default model', () => {
		expect(() =>
			catalogModels(
				base,
				usable,
				create(GetDefaultModelForCliResponseSchema, {
					model: create(ModelDetailsSchema, { modelId: 'missing' }),
				}),
				'https://api2.cursor.sh',
			),
		).toThrow("Cursor default model 'missing' is not usable");
	});
});
