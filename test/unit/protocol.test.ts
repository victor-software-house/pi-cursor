import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');
const protoPath = join(root, 'proto', 'aiserver', 'v1', 'inference.proto');
const generatedPath = join(root, 'src', 'gen', 'aiserver', 'v1', 'inference_pb.ts');
const lockPath = join(root, 'docs', 'protocol', 'inference-service-3.18.9', 'artifact-lock.json');
const catalogAgentProto = join(root, 'proto', 'agent', 'v1', 'catalog.proto');
const catalogAiProto = join(root, 'proto', 'aiserver', 'v1', 'catalog.proto');
const catalogAgentGenerated = join(root, 'src', 'gen', 'agent', 'v1', 'catalog_pb.ts');
const catalogAiGenerated = join(root, 'src', 'gen', 'aiserver', 'v1', 'catalog_pb.ts');
const catalogLockPath = join(root, 'docs', 'protocol', 'catalog-2026.09.02', 'artifact-lock.json');

async function sha256(path: string): Promise<string> {
	return createHash('sha256')
		.update(new Uint8Array(await Bun.file(path).arrayBuffer()))
		.digest('hex');
}

describe('selected Cursor 3.18.9 protocol closure', () => {
	test('keeps the exact reconstructed RunInference schema', async () => {
		expect(await sha256(protoPath)).toBe(
			'8af274ea2788ca7404b05febe17bed2462f9500906bcf4c836bc8f7999d77247',
		);
		const source = await Bun.file(protoPath).text();
		expect(source.match(/^message /gmu)?.length).toBe(54);
		expect(source.match(/^enum /gmu)?.length).toBe(4);
		expect(source).toContain(
			'rpc RunInference(stream .aiserver.v1.RunInferenceClientMessage) returns (stream .aiserver.v1.RunInferenceServerMessage);',
		);
	});

	test('generates only the transitive RunInference message closure', async () => {
		const generated = await Bun.file(generatedPath).text();
		expect(generated.match(/^export const .*Schema: GenMessage/gmu)?.length).toBe(52);
		expect(generated.match(/^export const .*Schema: GenEnum/gmu)?.length).toBe(4);
		expect(generated.match(/^export const .*Schema: GenService/gmu)).toBeNull();
		expect(generated).toContain('export const RunInferenceClientMessageSchema');
		expect(generated).toContain('export const RunInferenceServerMessageSchema');
	});

	test('pins the exact Cursor artifact and source modules', async () => {
		expect(await sha256(lockPath)).toBe(
			'83bcbeb86a49d9d127e425f207c49a01690b7503f60fb79ae3f19e12670fb040',
		);
		const lock: unknown = await Bun.file(lockPath).json();
		expect(lock).toMatchObject({
			version: '3.18.9',
			commit: '2ba48ff3f7514cc4643c52ca9f7b3173d9b66130',
			real_commit: '2ba48ff3f7514cc4643c52ca9f7b3173d9b66137',
			artifact: {
				bytes: 270_656_436,
				sha256: 'dc43417a2c44f7221fb764f329d9b7edf819253ee01c8bc9abb562ae020270e4',
			},
			modules: {
				schema: '657.js:8844',
				service: '657.js:4410',
				transport_factory: '657.js:41033',
				managed_inference: '675.js:40675',
			},
		});
	});
});

describe('selected Cursor CLI catalog closure', () => {
	test('pins the exact reconstructed schema and selected public protos', async () => {
		expect(await sha256(catalogLockPath)).toBe(
			'c81e4a9b75091f471a2690a048099d828e2204a6d9f11cc14885f9cba86a3aca',
		);
		expect(await sha256(catalogAgentProto)).toBe(
			'8811911c4633feaa93fd4ac984a22603aae067be7ada0c8c088acb3039fa81ea',
		);
		expect(await sha256(catalogAiProto)).toBe(
			'aa330a68a037543dac2203000b8d1ae884c6733c1a4a193070f8c09ae1821987',
		);
		const lock: unknown = await Bun.file(catalogLockPath).json();
		expect(lock).toMatchObject({
			version: '2026.09.02-fa0c06e',
			platform: 'darwin/arm64',
			bundle: {
				bytes: 9_562_048,
				sha256: '40281ab25e88ddc8d4e8fc38890e2ea14d5fa4261e7c19931e0feb8f58fa3a55',
			},
			reconstructed_schema: {
				unresolved: 0,
				sha256: '535f6ff6968ba6c3578ca164fc2fbcac44a0b553ab01d5e919b3c1a736b7e605',
			},
			selected: {
				service: 'aiserver.v1.AiService',
				methods: ['AvailableModels', 'GetUsableModels', 'GetDefaultModelForCli'],
			},
		});
	});

	test('generates only the ten selected catalog messages', async () => {
		const [agent, ai] = await Promise.all([
			Bun.file(catalogAgentGenerated).text(),
			Bun.file(catalogAiGenerated).text(),
		]);
		expect(agent.match(/^export const .*Schema: GenMessage/gmu)?.length).toBe(6);
		expect(ai.match(/^export const .*Schema: GenMessage/gmu)?.length).toBe(4);
		expect(`${agent}\n${ai}`.match(/^export const .*Schema: GenService/gmu)).toBeNull();
	});
});
