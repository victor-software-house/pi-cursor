import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { DescMessage, MessageShape } from '@bufbuild/protobuf';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type {
	GetDefaultModelForCliResponse,
	GetUsableModelsResponse,
	ModelDetails,
} from '@cursor/gen/agent/v1/catalog_pb';
import {
	GetDefaultModelForCliRequestSchema,
	GetDefaultModelForCliResponseSchema,
	GetUsableModelsRequestSchema,
	GetUsableModelsResponseSchema,
} from '@cursor/gen/agent/v1/catalog_pb';
import type { AvailableModelsResponse } from '@cursor/gen/aiserver/v1/catalog_pb';
import {
	AvailableModelsRequestSchema,
	AvailableModelsResponseSchema,
} from '@cursor/gen/aiserver/v1/catalog_pb';
import type { Model, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { thrownMessage } from '@victor-software-house/pi-type-kit';

const service = 'aiserver.v1.AiService';
const cliVersion = 'cli-2026.09.02-fa0c06e-lab';
const responseLimit = 4 * 1024 * 1024;
const timeoutMs = 10_000;
const cacheMs = 10 * 60 * 1_000;
const defaultContextWindow = 200_000;
const defaultMaxTokens = 64_000;
const effortSuffix = /^(.*)-(none|minimal|low|medium|high|xhigh|extra-high|max)(-fast)?$/u;
const levels: Record<string, keyof ThinkingLevelMap> = {
	none: 'off',
	minimal: 'minimal',
	low: 'low',
	medium: 'medium',
	high: 'high',
	xhigh: 'xhigh',
	'extra-high': 'xhigh',
	max: 'max',
};
const preferredLevels: (keyof ThinkingLevelMap)[] = [
	'medium',
	'high',
	'low',
	'minimal',
	'xhigh',
	'max',
	'off',
];

export type CursorHttpRequest = (
	options: RequestOptions,
	callback: (response: IncomingMessage) => void,
) => ClientRequest;

export interface CursorCatalogOptions {
	readonly backendUrl: string;
	readonly token: string;
	readonly signal?: AbortSignal;
	readonly request?: CursorHttpRequest;
	readonly now?: () => number;
	readonly force?: boolean;
}

interface CatalogCache {
	readonly key: string;
	readonly expiresAt: number;
	readonly models: Model<'cursor-inference'>[];
}

let cache: CatalogCache | undefined;

function backendOrigin(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		throw new Error('Cursor backend authority is invalid', { cause: error });
	}
	if (
		url.protocol !== 'https:' ||
		url.username !== '' ||
		url.password !== '' ||
		(url.pathname !== '' && url.pathname !== '/') ||
		url.search !== '' ||
		url.hash !== ''
	) {
		throw new Error('Cursor backend authority must be an HTTPS origin');
	}
	return new URL(url.origin);
}

function decoded(body: Uint8Array, encoding: string | undefined): Uint8Array {
	if (encoding === 'gzip') return new Uint8Array(gunzipSync(body));
	if (encoding === 'br') return new Uint8Array(brotliDecompressSync(body));
	return body;
}

function unary<Req extends DescMessage, Res extends DescMessage>(
	method: string,
	request: { readonly schema: Req; readonly message: MessageShape<Req> },
	response: Res,
	options: CursorCatalogOptions,
): Promise<MessageShape<Res>> {
	const origin = backendOrigin(options.backendUrl);
	const body = toBinary(request.schema, request.message);
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted === true) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const send = options.request ?? httpsRequest;
		const req = send(
			{
				protocol: 'https:',
				host: origin.hostname,
				port: origin.port === '' ? 443 : origin.port,
				path: `/${service}/${method}`,
				method: 'POST',
				headers: {
					'accept-encoding': 'gzip,br',
					authorization: `Bearer ${options.token}`,
					'connect-protocol-version': '1',
					'content-type': 'application/proto',
					'user-agent': 'connect-es/1.6.1',
					'x-cursor-client-type': 'cli',
					'x-cursor-client-version': cliVersion,
					'x-ghost-mode': 'false',
					'x-request-id': crypto.randomUUID(),
					...(body.length === 0 ? { 'content-length': '0' } : {}),
				},
			},
			(incoming) => {
				const chunks: Uint8Array[] = [];
				let size = 0;
				incoming.on('data', (chunk: Uint8Array) => {
					size += chunk.length;
					if (size > responseLimit) {
						req.destroy(new Error('Cursor catalog response exceeded its size limit'));
						return;
					}
					chunks.push(chunk);
				});
				incoming.on('end', () => {
					if (incoming.statusCode !== 200) {
						reject(new Error(`Cursor ${method} returned HTTP ${String(incoming.statusCode ?? 0)}`));
						return;
					}
					try {
						const bytes = decoded(Buffer.concat(chunks), incoming.headers['content-encoding']);
						resolve(fromBinary(response, bytes));
					} catch (error) {
						reject(
							new Error(`Cursor ${method} returned invalid protobuf: ${thrownMessage(error)}`),
						);
					}
				});
				incoming.on('error', reject);
			},
		);
		req.on('error', reject);
		req.setTimeout(timeoutMs, () => req.destroy(new Error(`Cursor ${method} timed out`)));
		const signal = options.signal;
		if (signal !== undefined) {
			const abort = (): void => {
				req.destroy(new DOMException('Aborted', 'AbortError'));
			};
			signal.addEventListener('abort', abort, { once: true });
			req.on('close', () => signal.removeEventListener('abort', abort));
		}
		if (body.length === 0) req.end();
		else {
			req.write(body);
			req.end();
		}
	});
}

interface ModelFamily {
	readonly id: string;
	readonly members: { readonly model: ModelDetails; readonly level: keyof ThinkingLevelMap }[];
}

type AvailableModel = AvailableModelsResponse['models'][number];

function familyFor(model: ModelDetails): {
	readonly id: string;
	readonly level: keyof ThinkingLevelMap;
} {
	const matched = effortSuffix.exec(model.modelId);
	const base = matched?.[1];
	const effort = matched?.[2];
	const fast = matched?.[3] === '-fast';
	const level = effort === undefined ? undefined : levels[effort];
	return base === undefined || level === undefined
		? { id: model.modelId, level: 'off' }
		: { id: `${base}${fast ? '-fast' : ''}`, level };
}

function modelFamilies(models: readonly ModelDetails[]): ModelFamily[] {
	const grouped = new Map<string, ModelFamily['members']>();
	for (const model of models) {
		if (model.modelId === '') continue;
		const member = familyFor(model);
		const members = grouped.get(member.id) ?? [];
		members.push({ model, level: member.level });
		grouped.set(member.id, members);
	}
	return [...grouped].map(([id, members]) => ({ id, members }));
}

function displayName(model: ModelDetails): string {
	return model.displayName || model.displayNameShort || model.displayModelId || model.modelId;
}

function baseModelFor(
	family: ModelFamily,
	models: readonly AvailableModel[],
): AvailableModel | undefined {
	const memberIds = new Set(family.members.map(({ model }) => model.modelId));
	return models.find(
		(model) =>
			model.name === family.id ||
			model.idAliases.includes(family.id) ||
			model.legacySlugs.some((slug) => memberIds.has(slug)) ||
			model.variants.some((variant) =>
				variant.legacySlug === undefined ? false : memberIds.has(variant.legacySlug),
			),
	);
}

function tooltipText(tooltip: AvailableModel['tooltipData']): string {
	return tooltip === undefined
		? ''
		: [
				tooltip.primaryText,
				tooltip.secondaryText,
				tooltip.tertiaryText,
				tooltip.markdownContent ?? '',
			].join('\n');
}

function hasDistinctMaxMode(model: AvailableModel): boolean {
	if (model.supportsMaxMode !== true) return false;
	if (model.supportsNonMaxMode === false) return true;
	if (
		model.contextTokenLimitForMaxMode !== undefined &&
		model.contextTokenLimitForMaxMode !== model.contextTokenLimit
	) {
		return true;
	}
	if (tooltipText(model.tooltipDataForMaxMode) !== tooltipText(model.tooltipData)) return true;
	if (model.variants.some((variant) => variant.isMaxMode)) return true;
	const normal = model.variants.find((variant) => variant.isDefaultNonMaxConfig === true);
	const max = model.variants.find((variant) => variant.isDefaultMaxConfig === true);
	return normal !== undefined && max !== undefined && normal !== max;
}

function variantContext(model: AvailableModel, maxMode: boolean): string | undefined {
	const variant = model.variants.find((candidate) =>
		maxMode ? candidate.isDefaultMaxConfig === true : candidate.isDefaultNonMaxConfig === true,
	);
	return variant?.parameterValues.find((parameter) => parameter.id === 'context')?.value;
}

function contextParameterTokens(value: string | undefined): number | undefined {
	const matched = /^(\d+(?:\.\d+)?)([km])$/u.exec(value ?? '');
	if (matched === null) return undefined;
	const amount = Number(matched[1]);
	const multiplier = matched[2] === 'm' ? 1_000_000 : 1_000;
	const tokens = amount * multiplier;
	return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : undefined;
}

function contextWindow(model: AvailableModel, maxMode: boolean): number {
	const selected = contextParameterTokens(variantContext(model, maxMode));
	if (selected !== undefined) return selected;
	const captured = maxMode
		? (model.contextTokenLimitForMaxMode ?? model.contextTokenLimit)
		: model.contextTokenLimit;
	return captured !== undefined && captured > 0 ? captured : defaultContextWindow;
}

function providerModel(
	family: ModelFamily,
	baseUrl: string,
	base: AvailableModel,
	maxMode: boolean,
): Model<'cursor-inference'> {
	const representative =
		preferredLevels.flatMap((level) =>
			family.members.filter((member) => member.level === level),
		)[0] ?? family.members[0];
	if (representative === undefined) throw new Error(`Cursor model family '${family.id}' is empty`);
	const thinkingLevelMap: ThinkingLevelMap = {};
	for (const member of family.members) thinkingLevelMap[member.level] = member.model.modelId;
	const reasoning = base.supportsThinking === true;
	const capturedName =
		base.clientDisplayName === undefined || base.clientDisplayName === ''
			? displayName(representative.model).replace(
					/ (?:None|Minimal|Low|Medium|High|Extra High|Max)(?= Fast$|$)/u,
					'',
				)
			: base.clientDisplayName;
	const context = variantContext(base, maxMode);
	const samplingParams = {
		...(maxMode ? { cursorMaxMode: true } : {}),
		...(context === undefined ? {} : { cursorContext: context }),
	};
	return {
		id: `${family.id}${maxMode ? '-max' : ''}`,
		name: `${capturedName}${maxMode ? ' Max' : ''}`,
		provider: 'cursor',
		api: 'cursor-inference',
		baseUrl,
		reasoning,
		input: base.supportsImages === true ? ['text', 'image'] : ['text'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: contextWindow(base, maxMode),
		maxTokens: defaultMaxTokens,
		...(Object.keys(samplingParams).length === 0 ? {} : { samplingParams }),
		...(reasoning && Object.keys(thinkingLevelMap).length > 0 ? { thinkingLevelMap } : {}),
	};
}

export function clearCursorCatalogCache(): void {
	cache = undefined;
}

export function catalogModels(
	base: AvailableModelsResponse,
	usable: GetUsableModelsResponse,
	defaultModel: GetDefaultModelForCliResponse,
	origin: string,
): Model<'cursor-inference'>[] {
	if (base.models.length === 0) throw new Error('Cursor AvailableModels returned no models');
	const models = modelFamilies(usable.models).flatMap((family) => {
		const baseModel = baseModelFor(family, base.models);
		if (baseModel === undefined) return [];
		return [
			...(baseModel.supportsNonMaxMode === false
				? []
				: [providerModel(family, origin, baseModel, false)]),
			...(hasDistinctMaxMode(baseModel) ? [providerModel(family, origin, baseModel, true)] : []),
		];
	});
	if (models.length === 0)
		throw new Error('Cursor catalog returned no fully described usable models');
	const defaultSelection = defaultModel.model;
	if (defaultSelection !== undefined && defaultSelection.modelId !== '') {
		const defaultId = defaultSelection.modelId;
		const selections = new Set(usable.models.map(({ modelId }) => modelId));
		if (!selections.has(defaultId)) {
			throw new Error(`Cursor default model '${defaultId}' is not usable`);
		}
		const defaultFamily = familyFor(defaultSelection).id;
		if (!models.some(({ id }) => id === defaultFamily || id === `${defaultFamily}-max`)) {
			throw new Error(`Cursor default model '${defaultId}' has no complete catalog metadata`);
		}
	}
	return models;
}

/** Fetch and cross-check Cursor's three catalog surfaces; never return stale data after failure. */
export async function discoverCursorModels(
	options: CursorCatalogOptions,
): Promise<Model<'cursor-inference'>[]> {
	if (options.token.includes('\r') || options.token.includes('\n')) {
		throw new Error('Cursor credential contains a line break');
	}
	const now = (options.now ?? Date.now)();
	const origin = backendOrigin(options.backendUrl).origin;
	const key = `${origin}:${await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.token)).then((value) => Buffer.from(value).toString('hex'))}`;
	if (options.force !== true && cache?.key === key && cache.expiresAt > now) return cache.models;

	const [base, usable, defaultModel] = await Promise.all([
		unary(
			'AvailableModels',
			{
				schema: AvailableModelsRequestSchema,
				message: create(AvailableModelsRequestSchema, {
					useModelParameters: true,
					doNotUseMarkdown: true,
				}),
			},
			AvailableModelsResponseSchema,
			options,
		),
		unary(
			'GetUsableModels',
			{ schema: GetUsableModelsRequestSchema, message: create(GetUsableModelsRequestSchema) },
			GetUsableModelsResponseSchema,
			options,
		),
		unary(
			'GetDefaultModelForCli',
			{
				schema: GetDefaultModelForCliRequestSchema,
				message: create(GetDefaultModelForCliRequestSchema),
			},
			GetDefaultModelForCliResponseSchema,
			options,
		),
	]);
	const models = catalogModels(base, usable, defaultModel, origin);
	cache = { key, expiresAt: now + cacheMs, models };
	return models;
}
