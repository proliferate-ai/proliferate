/**
 * Shared type guard utilities.
 */

/** Narrows `unknown` to a plain object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
