import { describe, expect, test } from 'bun:test';
import { reconcileFinalContent } from '@cursor/reconciliation';
import type { AssistantMessage } from '@earendil-works/pi-ai';

type Content = AssistantMessage['content'];

const tool = (id: string, name = 'join', value = 'ok'): Content[number] => ({
	type: 'toolCall',
	id,
	name,
	arguments: { value },
});

const thinking = (text: string, signature?: string, redacted?: true): Content[number] => ({
	type: 'thinking',
	thinking: text,
	...(signature === undefined ? {} : { thinkingSignature: signature }),
	...(redacted === undefined ? {} : { redacted }),
});

describe('Cursor final content reconciliation', () => {
	test('requires completed streamed and final tools to match exactly by id, name, and arguments', () => {
		const exact = reconcileFinalContent([tool('call-1')], [tool('call-1')]);
		expect(exact.content).toEqual([tool('call-1')]);
		expect(exact.summary.tools).toEqual({ streamed: 1, final: 1, status: 'exact' });

		expect(() => reconcileFinalContent([tool('call-1')], [])).toThrow(
			'Cursor final response tool set does not match completed streamed tools',
		);
		expect(() => reconcileFinalContent([tool('call-1')], [tool('call-2')])).toThrow(
			'Cursor final response tool set does not match completed streamed tools',
		);
		expect(() => reconcileFinalContent([tool('call-1')], [tool('call-1', 'other')])).toThrow(
			"Cursor final response changed the name of tool 'call-1'",
		);
		expect(() =>
			reconcileFinalContent([tool('call-1')], [tool('call-1', 'join', 'changed')]),
		).toThrow("Cursor final response changed the arguments of tool 'call-1'");
	});

	test('can accept final tools without equality checks when strict reconciliation is off', () => {
		const result = reconcileFinalContent(
			[tool('call-1', 'join', 'streamed')],
			[tool('call-1', 'join', 'final')],
			{ strict: false },
		);
		expect(result.content).toEqual([tool('call-1', 'join', 'final')]);
		expect(result.summary).toMatchObject({
			strict: false,
			tools: { streamed: 1, final: 1, status: 'unchecked' },
		});
	});

	test('accepts final-only tools and preserves stream-only tools when responseInfo is absent', () => {
		const finalOnly = reconcileFinalContent([], [tool('call-1')]);
		expect(finalOnly.content).toEqual([tool('call-1')]);
		expect(finalOnly.summary.tools.status).toBe('final-only');

		const streamOnly = reconcileFinalContent([tool('call-1')]);
		expect(streamOnly.content).toEqual([tool('call-1')]);
		expect(streamOnly.summary.tools.status).toBe('stream-only');
	});

	test('uses final text when present and otherwise preserves streamed text without prefix matching', () => {
		const absent = reconcileFinalContent([{ type: 'text', text: 'complete stream' }], []);
		expect(absent.content).toEqual([{ type: 'text', text: 'complete stream' }]);
		expect(absent.summary.text).toMatchObject({ source: 'stream', exact: null });

		const different = reconcileFinalContent(
			[{ type: 'text', text: 'stream draft' }],
			[{ type: 'text', text: 'rewritten final' }],
		);
		expect(different.content).toEqual([{ type: 'text', text: 'rewritten final' }]);
		expect(different.summary.text).toEqual({
			streamedBlocks: 1,
			finalBlocks: 1,
			streamedCharacters: 12,
			finalCharacters: 15,
			exact: false,
			source: 'final',
		});
	});

	test('merges one opaque final block only when one streamed text block is unambiguous', () => {
		const result = reconcileFinalContent(
			[thinking('streamed analysis')],
			[thinking('', 'final-signature', true), { type: 'text', text: 'answer' }],
		);
		expect(result.content).toEqual([
			thinking('streamed analysis', 'final-signature', true),
			{ type: 'text', text: 'answer' },
		]);
		expect(result.summary.reasoning).toMatchObject({
			source: 'stream',
			mergedMetadata: 1,
			unmatchedMetadata: 0,
		});
	});

	test('never attaches several opaque final blocks to streamed reasoning by array index', () => {
		const result = reconcileFinalContent(
			[thinking('first stream block'), thinking('second stream block')],
			[
				thinking('', 'first-final-signature', true),
				thinking('', 'second-final-signature', true),
				{ type: 'text', text: 'answer' },
			],
		);
		expect(result.content).toEqual([
			thinking('first stream block'),
			thinking('second stream block'),
			thinking('', 'first-final-signature', true),
			thinking('', 'second-final-signature', true),
			{ type: 'text', text: 'answer' },
		]);
		expect(result.summary.reasoning).toMatchObject({
			mergedMetadata: 0,
			unmatchedMetadata: 2,
		});
	});

	test('matches reasoning metadata by exact signature before considering text', () => {
		const result = reconcileFinalContent(
			[thinking('streamed analysis', 'same-signature')],
			[thinking('', 'same-signature', true), { type: 'text', text: 'answer' }],
		);
		expect(result.content[0]).toEqual(thinking('streamed analysis', 'same-signature', true));
		expect(result.summary.reasoning).toMatchObject({
			mergedMetadata: 1,
			unmatchedMetadata: 0,
		});
	});

	test('keeps non-empty final reasoning authoritative and preserves unmatched stream metadata', () => {
		const result = reconcileFinalContent(
			[thinking('draft', 'stream-signature')],
			[thinking('final'), { type: 'text', text: 'answer' }],
		);
		expect(result.content).toEqual([
			thinking('final'),
			thinking('', 'stream-signature'),
			{ type: 'text', text: 'answer' },
		]);
		expect(result.summary.reasoning).toMatchObject({
			source: 'final',
			mergedMetadata: 0,
			unmatchedMetadata: 1,
		});
	});
});
