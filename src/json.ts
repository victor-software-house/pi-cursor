import type { JsonObject, JsonValue } from '@bufbuild/protobuf';
import { isRecord } from '@victor-software-house/pi-type-kit';

/** Convert one validated JavaScript value to protobuf JSON without assertions or `any`. */
export function jsonValue(value: unknown): JsonValue {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		if (typeof value === 'number' && !Number.isFinite(value)) {
			throw new Error('Cursor inference JSON contains a non-finite number');
		}
		return value;
	}
	if (Array.isArray(value)) return value.map((entry) => jsonValue(entry));
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, entry]) => entry !== undefined)
				.map(([key, entry]) => [key, jsonValue(entry)]),
		);
	}
	throw new Error('Cursor inference value is not JSON-serializable');
}

export function jsonObject(value: unknown): JsonObject | undefined {
	if (!isRecord(value)) return undefined;
	const converted: JsonObject = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry !== undefined) converted[key] = jsonValue(entry);
	}
	return converted;
}

export function requiredJsonObject(value: unknown, label: string): JsonObject {
	const object = jsonObject(value);
	if (object === undefined) throw new Error(`${label} must be a JSON object`);
	return object;
}
