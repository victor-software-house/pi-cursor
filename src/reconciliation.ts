import { isDeepStrictEqual } from 'node:util';
import type { AssistantMessage, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import { omitUndefined } from '@victor-software-house/pi-type-kit';

type Content = AssistantMessage['content'];

export interface ReconciliationSummary {
	readonly responseInfo: boolean;
	readonly strict: boolean;
	readonly text: {
		readonly streamedBlocks: number;
		readonly finalBlocks: number;
		readonly streamedCharacters: number;
		readonly finalCharacters: number;
		readonly exact: boolean | null;
		readonly source: 'stream' | 'final' | 'none';
	};
	readonly reasoning: {
		readonly streamedBlocks: number;
		readonly finalBlocks: number;
		readonly streamedCharacters: number;
		readonly finalCharacters: number;
		readonly exact: boolean | null;
		readonly source: 'stream' | 'final' | 'opaque-final' | 'none';
		readonly mergedMetadata: number;
		readonly unmatchedMetadata: number;
	};
	readonly tools: {
		readonly streamed: number;
		readonly final: number;
		readonly status: 'none' | 'exact' | 'unchecked' | 'stream-only' | 'final-only';
	};
}

export interface ReconciliationOptions {
	readonly strict?: boolean;
}

export interface ReconciledContent {
	readonly content: Content;
	readonly summary: ReconciliationSummary;
}

function textBlocks(content: Content): Extract<Content[number], { type: 'text' }>[] {
	return content.filter((block) => block.type === 'text');
}

function thinkingBlocks(content: Content): ThinkingContent[] {
	return content.filter((block) => block.type === 'thinking');
}

function toolBlocks(content: Content): ToolCall[] {
	return content.filter((block) => block.type === 'toolCall');
}

function combinedText(blocks: readonly { readonly text: string }[]): string {
	return blocks.map(({ text }) => text).join('');
}

function combinedThinking(blocks: readonly ThinkingContent[]): string {
	return blocks.map(({ thinking }) => thinking).join('');
}

function signature(block: ThinkingContent): string | undefined {
	return block.thinkingSignature === undefined || block.thinkingSignature === ''
		? undefined
		: block.thinkingSignature;
}

function hasMetadata(block: ThinkingContent): boolean {
	return signature(block) !== undefined || block.redacted === true;
}

function mergeMetadata(target: ThinkingContent, source: ThinkingContent): ThinkingContent {
	return {
		...target,
		...omitUndefined({
			thinkingSignature: signature(source) ?? signature(target),
			redacted: source.redacted === true || target.redacted === true ? true : undefined,
		}),
	};
}

function metadataBlock(block: ThinkingContent): ThinkingContent {
	return {
		type: 'thinking',
		thinking: '',
		...omitUndefined({
			thinkingSignature: signature(block),
			redacted: block.redacted === true ? true : undefined,
		}),
	};
}

function sameMetadata(left: ThinkingContent, right: ThinkingContent): boolean {
	return signature(left) === signature(right) && left.redacted === right.redacted;
}

function appendMetadata(blocks: ThinkingContent[], metadata: ThinkingContent): boolean {
	if (!hasMetadata(metadata)) return false;
	const projected = metadataBlock(metadata);
	if (blocks.some((block) => sameMetadata(block, projected))) return false;
	blocks.push(projected);
	return true;
}

function reconcileThinking(
	streamed: readonly ThinkingContent[],
	final: readonly ThinkingContent[],
): {
	readonly blocks: ThinkingContent[];
	readonly source: ReconciliationSummary['reasoning']['source'];
	readonly mergedMetadata: number;
	readonly unmatchedMetadata: number;
} {
	const finalHasText = final.some(({ thinking }) => thinking.trim() !== '');
	if (finalHasText) {
		const blocks = final.map((block) => ({ ...block }));
		let mergedMetadata = 0;
		let unmatchedMetadata = 0;
		for (const candidate of streamed.filter(hasMetadata)) {
			const candidateSignature = signature(candidate);
			let match =
				candidateSignature === undefined
					? -1
					: blocks.findIndex((block) => signature(block) === candidateSignature);
			if (match < 0 && candidate.thinking.trim() !== '') {
				match = blocks.findIndex((block) => block.thinking === candidate.thinking);
			}
			if (match >= 0) {
				const target = blocks[match];
				if (target !== undefined) blocks[match] = mergeMetadata(target, candidate);
				mergedMetadata += 1;
			} else if (appendMetadata(blocks, candidate)) {
				unmatchedMetadata += 1;
			}
		}
		return { blocks, source: 'final', mergedMetadata, unmatchedMetadata };
	}

	const blocks = streamed.map((block) => ({ ...block }));
	const unmatchedFinal: ThinkingContent[] = [];
	let mergedMetadata = 0;
	for (const candidate of final.filter(hasMetadata)) {
		const candidateSignature = signature(candidate);
		const match =
			candidateSignature === undefined
				? -1
				: blocks.findIndex((block) => signature(block) === candidateSignature);
		if (match >= 0) {
			const target = blocks[match];
			if (target !== undefined) blocks[match] = mergeMetadata(target, candidate);
			mergedMetadata += 1;
		} else {
			unmatchedFinal.push(candidate);
		}
	}

	const attachable = blocks
		.map((block, index) => ({ block, index }))
		.filter(({ block }) => block.thinking.trim() !== '' && !hasMetadata(block));
	if (unmatchedFinal.length === 1 && attachable.length === 1) {
		const target = attachable[0];
		const metadata = unmatchedFinal[0];
		if (target !== undefined && metadata !== undefined) {
			blocks[target.index] = mergeMetadata(target.block, metadata);
			mergedMetadata += 1;
			unmatchedFinal.length = 0;
		}
	}

	let unmatchedMetadata = 0;
	for (const candidate of unmatchedFinal) {
		if (appendMetadata(blocks, candidate)) unmatchedMetadata += 1;
	}
	const source = blocks.some(({ thinking }) => thinking.trim() !== '')
		? 'stream'
		: blocks.length > 0
			? 'opaque-final'
			: 'none';
	return { blocks, source, mergedMetadata, unmatchedMetadata };
}

function indexedTools(
	blocks: readonly ToolCall[],
	source: 'streamed' | 'final',
): Map<string, ToolCall> {
	const indexed = new Map<string, ToolCall>();
	for (const block of blocks) {
		if (indexed.has(block.id))
			throw new Error(`Cursor ${source} response duplicated tool '${block.id}'`);
		indexed.set(block.id, block);
	}
	return indexed;
}

function compareTools(streamed: readonly ToolCall[], final: readonly ToolCall[]): void {
	const streamedById = indexedTools(streamed, 'streamed');
	const finalById = indexedTools(final, 'final');
	if (streamedById.size !== finalById.size) {
		throw new Error('Cursor final response tool set does not match completed streamed tools');
	}
	for (const [id, streamedTool] of streamedById) {
		const finalTool = finalById.get(id);
		if (finalTool === undefined) {
			throw new Error('Cursor final response tool set does not match completed streamed tools');
		}
		if (streamedTool.name !== finalTool.name) {
			throw new Error(`Cursor final response changed the name of tool '${id}'`);
		}
		if (!isDeepStrictEqual(streamedTool.arguments, finalTool.arguments)) {
			throw new Error(`Cursor final response changed the arguments of tool '${id}'`);
		}
	}
}

export function reconcileFinalContent(
	streamed: Content,
	final?: Content,
	options: ReconciliationOptions = {},
): ReconciledContent {
	const strict = options.strict ?? true;
	const streamedText = textBlocks(streamed);
	const finalText = final === undefined ? [] : textBlocks(final);
	const streamedThinking = thinkingBlocks(streamed);
	const finalThinking = final === undefined ? [] : thinkingBlocks(final);
	const streamedTools = toolBlocks(streamed);
	const finalTools = final === undefined ? [] : toolBlocks(final);

	if (strict && final !== undefined && streamedTools.length > 0) {
		compareTools(streamedTools, finalTools);
	} else {
		indexedTools(streamedTools, 'streamed');
		indexedTools(finalTools, 'final');
	}

	const textSource = finalText.length > 0 ? 'final' : streamedText.length > 0 ? 'stream' : 'none';
	const selectedText = finalText.length > 0 ? finalText : streamedText;
	const selectedTools = finalTools.length > 0 ? finalTools : streamedTools;
	const reasoning = reconcileThinking(streamedThinking, finalThinking);
	const finalHasNonReasoning = finalText.length > 0 || finalTools.length > 0;
	const nonReasoning = finalHasNonReasoning
		? (final?.filter((block) => block.type !== 'thinking') ?? [])
		: streamed.filter((block) => block.type !== 'thinking');
	const content =
		final === undefined
			? streamed
			: finalText.length === 0 && finalTools.length > 0 && streamedText.length > 0
				? [...reasoning.blocks, ...selectedText, ...selectedTools]
				: [...reasoning.blocks, ...nonReasoning];
	const streamedTextValue = combinedText(streamedText);
	const finalTextValue = combinedText(finalText);
	const streamedThinkingValue = combinedThinking(streamedThinking);
	const finalThinkingValue = combinedThinking(finalThinking);
	const toolStatus =
		streamedTools.length > 0 && finalTools.length > 0
			? strict
				? 'exact'
				: 'unchecked'
			: streamedTools.length > 0
				? 'stream-only'
				: finalTools.length > 0
					? 'final-only'
					: 'none';

	return {
		content,
		summary: {
			responseInfo: final !== undefined,
			strict,
			text: {
				streamedBlocks: streamedText.length,
				finalBlocks: finalText.length,
				streamedCharacters: streamedTextValue.length,
				finalCharacters: finalTextValue.length,
				exact:
					streamedText.length > 0 && finalText.length > 0
						? streamedTextValue === finalTextValue
						: null,
				source: textSource,
			},
			reasoning: {
				streamedBlocks: streamedThinking.length,
				finalBlocks: finalThinking.length,
				streamedCharacters: streamedThinkingValue.length,
				finalCharacters: finalThinkingValue.length,
				exact:
					streamedThinking.some(({ thinking }) => thinking.trim() !== '') &&
					finalThinking.some(({ thinking }) => thinking.trim() !== '')
						? streamedThinkingValue === finalThinkingValue
						: null,
				source: reasoning.source,
				mergedMetadata: reasoning.mergedMetadata,
				unmatchedMetadata: reasoning.unmatchedMetadata,
			},
			tools: {
				streamed: streamedTools.length,
				final: finalTools.length,
				status: toolStatus,
			},
		},
	};
}
