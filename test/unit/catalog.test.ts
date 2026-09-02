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
