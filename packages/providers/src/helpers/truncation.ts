/**
 * JSON-aware structural truncation.
 *
 * Prunes arrays and objects structurally so the result is ALWAYS valid JSON.
 * Never string-slices — instead removes trailing array elements or object keys
 * until the serialized result fits within the byte limit.
 */

const DEFAULT_MAX_BYTES = 10 * 1024; // 10KB

/**
 * Truncate a value to fit within maxBytes when serialized.
 * Returns the original value unchanged if it fits.
 * Returns a structurally pruned copy with `_truncated: true` if it doesn't.
 */
export function truncateJson(data: unknown, maxBytes = DEFAULT_MAX_BYTES): unknown {
	if (data === null || data === undefined) return data;

	const serialized = JSON.stringify(data);
	if (serialized === undefined) return data;
	if (Buffer.byteLength(serialized, "utf-8") <= maxBytes) return data;

	const originalSize = Buffer.byteLength(serialized, "utf-8");

	if (Array.isArray(data)) {
		return truncateArray(data, maxBytes, originalSize);
	}
	if (typeof data === "object") {
		return truncateObject(data as Record<string, unknown>, maxBytes, originalSize);
	}

	// Primitive that's too large (huge string) — return metadata only
	return { _truncated: true, _originalSize: originalSize };
}

function truncateArray(arr: unknown[], maxBytes: number, originalSize: number): unknown {
	// Binary search for the max number of elements that fit
	let lo = 0;
	let hi = arr.length;

	while (lo < hi) {
		const mid = Math.floor((lo + hi + 1) / 2);
		const candidate = buildTruncatedArray(arr, mid, originalSize);
		if (Buffer.byteLength(JSON.stringify(candidate), "utf-8") <= maxBytes) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}

	return buildTruncatedArray(arr, lo, originalSize);
}

function buildTruncatedArray(arr: unknown[], keepCount: number, originalSize: number): unknown {
	if (keepCount >= arr.length) return arr;
	const omitted = arr.length - keepCount;
	const result = arr.slice(0, keepCount);
	return {
		_truncated: true,
		_originalSize: originalSize,
		items: result,
		_omitted: `${omitted} more items`,
	};
}

function truncateObject(
	obj: Record<string, unknown>,
	maxBytes: number,
	originalSize: number,
): unknown {
	const keys = Object.keys(obj);

	// Binary search for the max number of keys that fit
	let lo = 0;
	let hi = keys.length;

	while (lo < hi) {
		const mid = Math.floor((lo + hi + 1) / 2);
		const candidate = buildTruncatedObject(obj, keys, mid, originalSize);
		if (Buffer.byteLength(JSON.stringify(candidate), "utf-8") <= maxBytes) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}

	return buildTruncatedObject(obj, keys, lo, originalSize);
}

function buildTruncatedObject(
	obj: Record<string, unknown>,
	keys: string[],
	keepCount: number,
	originalSize: number,
): Record<string, unknown> {
	if (keepCount >= keys.length) return obj;
	const result: Record<string, unknown> = { _truncated: true, _originalSize: originalSize };
	for (let i = 0; i < keepCount; i++) {
		result[keys[i]] = obj[keys[i]];
	}
	result._omittedKeys = keys.length - keepCount;
	return result;
}
