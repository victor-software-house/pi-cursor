import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');
const protoPath = join(root, 'proto', 'aiserver', 'v1', 'inference.proto');
const generatedPath = join(root, 'src', 'gen', 'aiserver', 'v1', 'inference_pb.ts');
const lockPath = join(root, 'docs', 'protocol', 'inference-service-3.18.9', 'artifact-lock.json');

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
