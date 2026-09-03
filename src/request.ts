import type { JsonValue } from '@bufbuild/protobuf';
import { create, fromJson } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import type {
	InferenceContentPart,
	InferenceCoreMessage,
	InferenceModelConfig,
	InferenceRequestedModel,
	InferenceStreamRequest,
	RunInferenceRoutingMessage,
	RunInferenceRunRequest,
} from '@cursor/gen/aiserver/v1/inference_pb';
import {
	InferenceAgentToolSchema,
	InferenceContentPartSchema,
	InferenceContentPartsSchema,
	InferenceCoreMessageSchema,
	InferenceImagePartSchema,
	InferenceMessageRole,
	InferenceModelConfigSchema,
	InferenceModelParameterValueSchema,
	InferenceReasoningPartSchema,
	InferenceRequestedModelSchema,
	InferenceStreamRequestSchema,
	InferenceTextPartSchema,
	InferenceToolCallSchema,
	InferenceToolResultContentSchema,
	InferenceToolResultPartSchema,
	RunInferenceRoutingMessageSchema,
	RunInferenceRoutingRole,
	RunInferenceRunRequestSchema,
} from '@cursor/gen/aiserver/v1/inference_pb';
import { validateCursorImage } from '@cursor/image';
import { jsonValue, requiredJsonObject } from '@cursor/json';
import { resolveRequestedModel } from '@cursor/model';
import type { Context, ImageContent, Message, Model, Tool } from '@earendil-works/pi-ai';
import { omitUndefined } from '@victor-software-house/pi-type-kit';

export interface CursorInferenceRequestOptions {
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly topP?: number;
	readonly stopSequences?: readonly string[];
}

function imagePart(image: ImageContent): InferenceContentPart {
	validateCursorImage(image);
	return create(InferenceContentPartSchema, {
		part: {
			case: 'image',
			value: create(InferenceImagePartSchema, {
				data: image.data,
				mimeType: image.mimeType,
			}),
		},
	});
}

function textPart(text: string): InferenceContentPart {
	return create(InferenceContentPartSchema, {
		part: { case: 'text', value: create(InferenceTextPartSchema, { text }) },
	});
}

function userContent(
	content: Extract<Message, { role: 'user' }>['content'],
): InferenceCoreMessage['content'] {
	if (typeof content === 'string') return { case: 'text', value: content };
	if (content.every((part) => part.type === 'text')) {
		return { case: 'text', value: content.map((part) => part.text).join('') };
	}
	return {
		case: 'parts',
		value: create(InferenceContentPartsSchema, {
			parts: content.map((part) => (part.type === 'text' ? textPart(part.text) : imagePart(part))),
		}),
	};
}

function toolResultJson(message: Extract<Message, { role: 'toolResult' }>): JsonValue {
	const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
	if (text.length === 1) return text[0] ?? '';
	return text.map((value) => jsonValue({ type: 'text', text: value }));
}

function toolResultExperimentalContent(
	message: Extract<Message, { role: 'toolResult' }>,
): InferenceContentPart[] {
	if (!message.content.some((part) => part.type === 'image')) return [];
	return message.content.map((part) =>
		part.type === 'text' ? textPart(part.text) : imagePart(part),
	);
}

export function messageToInference(message: Message): InferenceCoreMessage {
	if (message.role === 'user') {
		return create(InferenceCoreMessageSchema, {
			role: InferenceMessageRole.USER,
			content: userContent(message.content),
		});
	}
	if (message.role === 'assistant') {
		const text: string[] = [];
		const reasoningParts = [];
		const toolCalls = [];
		for (const part of message.content) {
			if (part.type === 'text') text.push(part.text);
			else if (part.type === 'thinking') {
				reasoningParts.push(
					create(
						InferenceReasoningPartSchema,
						omitUndefined({
							isRedacted: part.redacted === true,
							text: part.thinking,
							signature: part.redacted === true ? undefined : part.thinkingSignature,
							redactedData: part.redacted === true ? part.thinkingSignature : undefined,
							modelName: message.provider === 'cursor' ? message.responseModel : undefined,
						}),
					),
				);
			} else {
				const args = requiredJsonObject(
					part.arguments,
					`Cursor inference tool '${part.name}' arguments`,
				);
				toolCalls.push(
					create(InferenceToolCallSchema, {
						toolCallId: part.id,
						toolName: part.name,
						args,
						rawToolCallArgs: JSON.stringify(args),
					}),
				);
			}
		}
		return create(
			InferenceCoreMessageSchema,
			omitUndefined({
				role: InferenceMessageRole.ASSISTANT,
				content: text.length === 0 ? undefined : { case: 'text' as const, value: text.join('') },
				reasoningParts,
				toolCalls,
				modelProviderMessageId: message.responseId,
			}),
		);
	}
	return create(InferenceCoreMessageSchema, {
		role: InferenceMessageRole.TOOL,
		content: {
			case: 'toolContent',
			value: create(InferenceToolResultContentSchema, {
				parts: [
					create(InferenceToolResultPartSchema, {
						toolCallId: message.toolCallId,
						toolName: message.toolName,
						result: fromJson(ValueSchema, toolResultJson(message)),
						isError: message.isError,
						experimentalContent: toolResultExperimentalContent(message),
					}),
				],
			}),
		},
	});
}

function toolToInference(tool: Tool) {
	const jsonSchema = requiredJsonObject(
		tool.parameters,
		`Cursor inference tool '${tool.name}' schema`,
	);
	return create(InferenceAgentToolSchema, {
		name: tool.name,
		description: tool.description,
		// Exact 3.18.9 source path: IO wraps the converted schema with yM.Og,
		// uO preserves that wrapper, and Uoe JSON-serializes it into this Struct.
		parameters: { jsonSchema },
	});
}

/** Build the complete per-invocation request. Routing and model selection remain on the outer run. */
export function buildInferenceRequest(
	context: Context,
	options: CursorInferenceRequestOptions = {},
): InferenceStreamRequest {
	const messages = context.messages.map(messageToInference);
	if (context.systemPrompt !== undefined && context.systemPrompt !== '') {
		messages.unshift(
			create(InferenceCoreMessageSchema, {
				role: InferenceMessageRole.SYSTEM,
				content: { case: 'text', value: context.systemPrompt },
			}),
		);
	}
	const modelConfig: InferenceModelConfig | undefined =
		options.maxTokens === undefined &&
		options.temperature === undefined &&
		options.topP === undefined &&
		options.stopSequences === undefined
			? undefined
			: create(
					InferenceModelConfigSchema,
					omitUndefined({
						maxTokens: options.maxTokens,
						temperature: options.temperature,
						topP: options.topP,
						stopSequences:
							options.stopSequences === undefined ? undefined : [...options.stopSequences],
					}),
				);
	return create(
		InferenceStreamRequestSchema,
		omitUndefined({
			messages,
			tools: context.tools?.map(toolToInference) ?? [],
			modelConfig,
		}),
	);
}

function routingText(message: Message): string {
	if (message.role === 'user') {
		return typeof message.content === 'string'
			? message.content
			: message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
	}
	if (message.role === 'assistant') {
		return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
	}
	return '';
}

function routingConversation(context: Context): RunInferenceRoutingMessage[] {
	return context.messages.flatMap((message) => {
		if (message.role === 'toolResult') return [];
		const text = routingText(message);
		if (text === '') return [];
		return [
			create(RunInferenceRoutingMessageSchema, {
				role:
					message.role === 'user'
						? RunInferenceRoutingRole.USER
						: RunInferenceRoutingRole.ASSISTANT,
				text,
			}),
		];
	});
}

export function inferenceRequestedModel(
	model: Model<'cursor-inference'>,
	reasoning: string | undefined,
	maxMode = false,
): InferenceRequestedModel {
	// Cursor IDE 3.18.9 stores max mode as explicit model-selection state. Ordinary
	// composer/cmd-k/plan/spec/deep-search/quick-agent defaults are false; only the
	// separate background-composer default is true. Never turn it on implicitly.
	const requested = resolveRequestedModel(model, omitUndefined({ maxMode, reasoning }));
	return create(InferenceRequestedModelSchema, {
		modelId: requested.modelId,
		maxMode: requested.maxMode,
		parameters: requested.parameters.map((parameter) =>
			create(InferenceModelParameterValueSchema, parameter),
		),
	});
}

export function inferenceRoutingKey(
	model: Model<'cursor-inference'>,
	reasoning: string | undefined,
	maxMode = false,
): string {
	const requested = inferenceRequestedModel(model, reasoning, maxMode);
	return JSON.stringify({
		modelId: requested.modelId,
		maxMode: requested.maxMode,
		parameters: requested.parameters.map(({ id, value }) => ({ id, value })),
	});
}

export function buildInferenceRunRequest(
	model: Model<'cursor-inference'>,
	context: Context,
	sessionId: string,
	reasoning: string | undefined,
	maxMode = false,
): RunInferenceRunRequest {
	if (sessionId === '') throw new Error('Cursor managed inference requires a stable Pi session id');
	return create(RunInferenceRunRequestSchema, {
		conversationId: sessionId,
		requestedModel: inferenceRequestedModel(model, reasoning, maxMode),
		routingConversation: routingConversation(context),
		agentMode: 'agent',
	});
}
