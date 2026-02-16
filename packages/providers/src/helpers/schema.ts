/**
 * Schema helpers — Zod → JSON Schema conversion and drift hashing.
 *
 * Used for MCP connector tool drift detection. Hashing rules:
 * - Deterministic JSON stringifier (sorted keys)
 * - Strip `description`, `default`, and `enum` before hashing to avoid
 *   false-positive drift from help text or enum value updates
 */

import { createHash } from "crypto";
import { type ZodType, z } from "zod";

// ============================================
// Zod → JSON Schema
// ============================================

/**
 * Convert a Zod schema to a stable JSON Schema representation.
 * Handles the common Zod types used in action definitions.
 */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
	return convertZodType(schema);
}

function convertZodType(schema: ZodType): Record<string, unknown> {
	if (schema instanceof z.ZodString) {
		return { type: "string" };
	}
	if (schema instanceof z.ZodNumber) {
		return { type: "number" };
	}
	if (schema instanceof z.ZodBoolean) {
		return { type: "boolean" };
	}
	if (schema instanceof z.ZodEnum) {
		return { type: "string", enum: schema._def.values };
	}
	if (schema instanceof z.ZodArray) {
		return { type: "array", items: convertZodType(schema._def.type) };
	}
	if (schema instanceof z.ZodOptional) {
		return convertZodType(schema._def.innerType);
	}
	if (schema instanceof z.ZodNullable) {
		const inner = convertZodType(schema._def.innerType);
		return { ...inner, nullable: true };
	}
	if (schema instanceof z.ZodDefault) {
		const inner = convertZodType(schema._def.innerType);
		return { ...inner, default: schema._def.defaultValue() };
	}
	if (schema instanceof z.ZodObject) {
		const shape = schema._def.shape();
		const properties: Record<string, unknown> = {};
		const required: string[] = [];

		for (const [key, value] of Object.entries(shape)) {
			properties[key] = convertZodType(value as ZodType);
			if (!(value instanceof z.ZodOptional)) {
				required.push(key);
			}
		}

		const result: Record<string, unknown> = { type: "object", properties };
		if (required.length > 0) {
			result.required = required;
		}
		return result;
	}
	if (schema instanceof z.ZodRecord) {
		return {
			type: "object",
			additionalProperties: convertZodType(schema._def.valueType),
		};
	}
	if (schema instanceof z.ZodUnion) {
		const options = (schema._def.options as ZodType[]).map(convertZodType);
		return { oneOf: options };
	}
	if (schema instanceof z.ZodLiteral) {
		return { type: typeof schema._def.value, const: schema._def.value };
	}
	if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) {
		return {};
	}

	// Fallback for unhandled types
	return {};
}

// ============================================
// Normalization (for hashing)
// ============================================

/** Keys stripped from schemas before hashing to prevent false-positive drift. */
const STRIP_KEYS = new Set(["description", "default", "enum"]);

/**
 * Recursively strip `description`, `default`, and `enum` from a JSON Schema.
 * These fields commonly change without affecting the tool's actual interface.
 */
export function normalizeSchemaForHash(schema: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(schema)) {
		if (STRIP_KEYS.has(key)) continue;

		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			result[key] = normalizeSchemaForHash(value as Record<string, unknown>);
		} else if (Array.isArray(value)) {
			result[key] = value.map((item) =>
				item !== null && typeof item === "object" && !Array.isArray(item)
					? normalizeSchemaForHash(item as Record<string, unknown>)
					: item,
			);
		} else {
			result[key] = value;
		}
	}

	return result;
}

// ============================================
// Definition Hashing
// ============================================

/**
 * Deterministic JSON stringify with sorted keys.
 */
function stableStringify(value: unknown): string {
	if (value === null || value === undefined) return JSON.stringify(value);
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const pairs = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
	return `{${pairs.join(",")}}`;
}

/**
 * Compute a stable hash for an action/tool definition.
 * Used for MCP connector tool drift detection.
 *
 * The hash covers the tool ID and its normalized parameter schema,
 * but NOT description, default values, or enum values.
 */
export function computeDefinitionHash(def: {
	id: string;
	params: ZodType | Record<string, unknown>;
}): string {
	// Check if params is a Zod schema by looking for the _def property
	const isZod = def.params != null && typeof def.params === "object" && "_def" in def.params;
	const jsonSchema = isZod
		? zodToJsonSchema(def.params as ZodType)
		: (def.params as Record<string, unknown>);
	const normalized = normalizeSchemaForHash(jsonSchema);
	const payload = { id: def.id, schema: normalized };
	return createHash("sha256").update(stableStringify(payload)).digest("hex");
}
