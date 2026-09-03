import type { ThinkingLevelMap } from '@earendil-works/pi-ai';

const capturedContextParameter = '272k';
const effortSuffix = /^(.*)-(none|minimal|low|medium|high|xhigh|extra-high|max)(-fast)?$/u;
const defaultLevels: (keyof ThinkingLevelMap)[] = [
	'medium',
	'high',
	'low',
	'minimal',
	'xhigh',
	'max',
	'off',
];

export interface CursorModelParameter {
	readonly id: string;
	readonly value: string;
}

export interface CursorRequestedModel {
	readonly modelId: string;
	readonly maxMode: boolean;
	readonly parameters: readonly CursorModelParameter[];
}

export interface CursorModelFlags {
	readonly maxMode: boolean;
	readonly context?: string;
	readonly reasoning?: string;
}

const specialSelections: Readonly<
	Record<string, { readonly modelId: string; readonly parameters: readonly CursorModelParameter[] }>
> = {
	'auto-smart': {
		modelId: 'auto-smart',
		parameters: [{ id: 'optimize_for', value: 'balanced' }],
	},
	'composer-2.5': {
		modelId: 'composer-2.5',
		parameters: [{ id: 'fast', value: 'false' }],
	},
	'cursor-grok-4.6-high': {
		modelId: 'grok-4.6',
		parameters: [
			{ id: 'effort', value: 'high' },
			{ id: 'fast', value: 'false' },
		],
	},
	'claude-opus-5-thinking-high': {
		modelId: 'claude-opus-5',
		parameters: [
			{ id: 'thinking', value: 'true' },
			{ id: 'context', value: '300k' },
			{ id: 'effort', value: 'high' },
			{ id: 'fast', value: 'false' },
		],
	},
	'gemini-3.7-flash-high': {
		modelId: 'gemini-3.7-flash',
		parameters: [{ id: 'effort', value: 'high' }],
	},
};

function selectedWireModel(
	model: { readonly id: string; readonly thinkingLevelMap?: ThinkingLevelMap },
	reasoning: string | undefined,
): string {
	const map = model.thinkingLevelMap;
	if (map === undefined) return model.id;
	if (reasoning !== undefined && reasoning !== '') {
		const selected = Object.entries(map).find(([level]) => level === reasoning)?.[1];
		if (typeof selected === 'string' && selected !== '') return selected;
	}
	for (const level of defaultLevels) {
		const selected = map[level];
		if (typeof selected === 'string' && selected !== '') return selected;
	}
	return model.id;
}

function isOpenAiModel(modelId: string): boolean {
	return /^(gpt-|o[1-9](?:-|$)|codex-)/u.test(modelId);
}

function withContext(
	parameters: readonly CursorModelParameter[],
	context: string | undefined,
): readonly CursorModelParameter[] {
	if (context === undefined) return parameters;
	const retained = parameters.filter(({ id }) => id !== 'context');
	return [{ id: 'context', value: context }, ...retained];
}

/** Resolve a Pi family and thinking level into Cursor's requested-model wire fields. */
export function resolveRequestedModel(
	model: { readonly id: string; readonly thinkingLevelMap?: ThinkingLevelMap },
	flags: CursorModelFlags,
): CursorRequestedModel {
	const modelId = selectedWireModel(model, flags.reasoning);
	const captured = specialSelections[modelId];
	if (captured !== undefined) {
		return {
			...captured,
			maxMode: flags.maxMode,
			parameters: withContext(captured.parameters, flags.context),
		};
	}

	const match = effortSuffix.exec(modelId);
	const base = match?.[1];
	const effort = match?.[2];
	const fast = match?.[3] === '-fast';
	if (base === undefined || effort === undefined || !isOpenAiModel(base)) {
		return { modelId, maxMode: flags.maxMode, parameters: [] };
	}
	return {
		modelId: `${base}${fast ? '-fast' : ''}`,
		maxMode: flags.maxMode,
		parameters: [
			{ id: 'context', value: flags.context ?? capturedContextParameter },
			{ id: 'reasoning', value: effort },
			{ id: 'fast', value: String(fast) },
		],
	};
}
