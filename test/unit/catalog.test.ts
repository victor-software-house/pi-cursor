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
import { inferenceRequestedModel } from '@cursor/request';

const base = create(AvailableModelsResponseSchema, {
	models: [
		create(AvailableModelsResponse_AvailableModelSchema, {
			name: 'gpt-5.6-sol',
			clientDisplayName: 'GPT-5.6 Sol',
			supportsThinking: true,
			supportsImages: true,
			supportsNonMaxMode: true,
			contextTokenLimit: 272_000,
		}),
		create(AvailableModelsResponse_AvailableModelSchema, {
			name: 'composer-2.5',
			clientDisplayName: 'Composer 2.5',
			supportsThinking: true,
			supportsImages: false,
			supportsNonMaxMode: true,
			contextTokenLimit: 200_000,
		}),
	],
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
		expect(models[1]).toMatchObject({
			id: 'composer-2.5',
			reasoning: true,
			input: ['text'],
			contextWindow: 200_000,
		});
	});

	test('requires explicit catalog support before advertising images or thinking', () => {
		const conservativeBase = create(AvailableModelsResponseSchema, {
			models: [
				create(AvailableModelsResponse_AvailableModelSchema, {
					name: 'default',
					clientDisplayName: 'Auto',
					supportsNonMaxMode: true,
				}),
			],
		});
		const conservativeUsable = create(GetUsableModelsResponseSchema, {
			models: [create(ModelDetailsSchema, { modelId: 'default', displayName: 'Auto' })],
		});
		expect(
			catalogModels(
				conservativeBase,
				conservativeUsable,
				create(GetDefaultModelForCliResponseSchema, { model: conservativeUsable.models[0] }),
				'https://api2.cursor.sh',
			),
		).toMatchObject([
			{
				id: 'default',
				reasoning: false,
				input: ['text'],
				contextWindow: 200_000,
			},
		]);
	});

	test('uses measured Grok capabilities without adding a redundant Max row', () => {
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

	test('uses the selected variant context as the effective Pi context window', () => {
		const claudeBase = create(AvailableModelsResponseSchema, {
			models: [
				create(AvailableModelsResponse_AvailableModelSchema, {
					name: 'claude-sonnet-4-6',
					clientDisplayName: 'Claude Sonnet 4.6',
					supportsThinking: true,
					supportsImages: true,
					supportsMaxMode: true,
					supportsNonMaxMode: true,
					contextTokenLimit: 1_000_000,
					contextTokenLimitForMaxMode: 1_000_000,
					variants: [
						{
							parameterValues: [{ id: 'context', value: '200k' }],
							displayName: 'Claude Sonnet 4.6',
							isDefaultNonMaxConfig: true,
							legacySlug: 'claude-4.6-sonnet-medium',
						},
						{
							parameterValues: [{ id: 'context', value: '1m' }],
							displayName: 'Claude Sonnet 4.6',
							isMaxMode: true,
							isDefaultMaxConfig: true,
							legacySlug: 'claude-4.6-sonnet-medium',
						},
					],
					legacySlugs: ['claude-4.6-sonnet-medium'],
				}),
			],
		});
		const claudeUsable = create(GetUsableModelsResponseSchema, {
			models: [
				create(ModelDetailsSchema, {
					modelId: 'claude-4.6-sonnet-medium',
					displayName: 'Claude Sonnet 4.6 Medium',
				}),
			],
		});
		expect(
			catalogModels(
				claudeBase,
				claudeUsable,
				create(GetDefaultModelForCliResponseSchema, { model: claudeUsable.models[0] }),
				'https://api2.cursor.sh',
			),
		).toMatchObject([
			{ id: 'claude-4.6-sonnet', contextWindow: 200_000 },
			{ id: 'claude-4.6-sonnet-max', contextWindow: 1_000_000 },
		]);
	});

	test('publishes only the Max row when non-Max mode is unsupported', () => {
		const maxOnlyBase = create(AvailableModelsResponseSchema, {
			models: [
				create(AvailableModelsResponse_AvailableModelSchema, {
					name: 'max-only',
					supportsImages: false,
					supportsThinking: false,
					supportsMaxMode: true,
					supportsNonMaxMode: false,
					contextTokenLimitForMaxMode: 400_000,
				}),
			],
		});
		const maxOnlyUsable = create(GetUsableModelsResponseSchema, {
			models: [create(ModelDetailsSchema, { modelId: 'max-only' })],
		});
		const models = catalogModels(
			maxOnlyBase,
			maxOnlyUsable,
			create(GetDefaultModelForCliResponseSchema, { model: maxOnlyUsable.models[0] }),
			'https://api2.cursor.sh',
		);
		expect(models).toMatchObject([
			{
				id: 'max-only-max',
				input: ['text'],
				reasoning: false,
				contextWindow: 400_000,
				samplingParams: { cursorMaxMode: true },
			},
		]);
		const model = models[0];
		if (model === undefined) throw new Error('expected Max-only model');
		expect(inferenceRequestedModel(model, undefined, true)).toMatchObject({
			modelId: 'max-only',
			maxMode: true,
		});
	});

	test('omits unmatched usable families rather than inventing capabilities', () => {
		const mixed = create(GetUsableModelsResponseSchema, {
			models: [
				create(ModelDetailsSchema, {
					modelId: 'gpt-5.6-sol-medium',
					displayName: 'GPT-5.6 Sol Medium',
				}),
				create(ModelDetailsSchema, { modelId: 'unknown-model', displayName: 'Unknown' }),
			],
		});
		const models = catalogModels(
			base,
			mixed,
			create(GetDefaultModelForCliResponseSchema, { model: mixed.models[0] }),
			'https://api2.cursor.sh',
		);
		expect(models.map(({ id }) => id)).toEqual(['gpt-5.6-sol']);
	});

	test('rejects an unmatched default model', () => {
		const mixed = create(GetUsableModelsResponseSchema, {
			models: [
				create(ModelDetailsSchema, {
					modelId: 'gpt-5.6-sol-medium',
					displayName: 'GPT-5.6 Sol Medium',
				}),
				create(ModelDetailsSchema, { modelId: 'unknown-model', displayName: 'Unknown' }),
			],
		});
		expect(() =>
			catalogModels(
				base,
				mixed,
				create(GetDefaultModelForCliResponseSchema, { model: mixed.models[1] }),
				'https://api2.cursor.sh',
			),
		).toThrow("Cursor default model 'unknown-model' has no complete catalog metadata");
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
