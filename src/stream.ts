import { create } from '@bufbuild/protobuf';
import type { RunInferenceServerMessage } from '@cursor/gen/aiserver/v1/inference_pb';
import { RunInferenceClientMessageSchema } from '@cursor/gen/aiserver/v1/inference_pb';
import {
	buildInferenceRequest,
	buildInferenceRunRequest,
	inferenceRoutingKey,
} from '@cursor/request';
import { CursorInferenceMapper } from '@cursor/response';
import type { CursorInferenceRuntime } from '@cursor/transport';
import type {
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { calculateCost, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { omitUndefined } from '@victor-software-house/pi-type-kit';

export interface CursorStreamRuntime {
	readonly runtime:
		| Pick<CursorInferenceRuntime, 'invoke'>
		| ((apiKey: string) => Promise<Pick<CursorInferenceRuntime, 'invoke'>>);
	readonly createInvocationId?: () => string;
}

function outputFor(model: Model<'cursor-inference'>): AssistantMessage {
	return {
		role: 'assistant',
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'pending',
		timestamp: Date.now(),
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** One Pi provider call is one correlated invocation on the session's routed outer run. */
export function streamCursor(
	model: Model<'cursor-inference'>,
	context: Context,
	runtime: CursorStreamRuntime,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const output = outputFor(model);

	void (async () => {
		try {
			stream.push({ type: 'start', partial: output });
			if (options?.apiKey === undefined || options.apiKey === '') {
				throw new Error('Cursor credential is unavailable');
			}
			const sessionId = options.sessionId;
			if (sessionId === undefined || sessionId === '') {
				throw new Error('Cursor managed inference requires SimpleStreamOptions.sessionId');
			}
			const invocationId = (runtime.createInvocationId ?? (() => crypto.randomUUID()))();
			const reasoning = typeof options.reasoning === 'string' ? options.reasoning : undefined;
			const request = buildInferenceRequest(context);
			const runRequest = create(RunInferenceClientMessageSchema, {
				message: {
					case: 'runRequest',
					value: buildInferenceRunRequest(model, context, sessionId, reasoning),
				},
			});
			const mapper = new CursorInferenceMapper(
				stream,
				output,
				new Set(context.tools?.map(({ name }) => name) ?? []),
				invocationId,
			);
			const runtimeForToken =
				typeof runtime.runtime === 'function'
					? await runtime.runtime(options.apiKey)
					: runtime.runtime;
			await runtimeForToken.invoke(
				sessionId,
				inferenceRoutingKey(model, reasoning),
				runRequest,
				invocationId,
				request,
				omitUndefined({
					signal: options.signal,
					onResponse: (message: RunInferenceServerMessage) => mapper.handle(message),
				}),
			);
			const result = mapper.finish();
			output.stopReason = result.stopReason;
			if (result.errorMessage !== undefined) output.errorMessage = result.errorMessage;
			calculateCost(model, output.usage);
			if (output.stopReason === 'error') {
				stream.push({ type: 'error', reason: 'error', error: output });
			} else if (
				output.stopReason === 'stop' ||
				output.stopReason === 'toolUse' ||
				output.stopReason === 'length' ||
				output.stopReason === 'deferred'
			) {
				stream.push({ type: 'done', reason: output.stopReason, message: output });
			} else {
				throw new Error(`Cursor mapper returned invalid terminal '${output.stopReason}'`);
			}
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted === true ? 'aborted' : 'error';
			output.errorMessage = errorMessage(error);
			stream.push({ type: 'error', reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}
