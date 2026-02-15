/**
 * Action mode resolution — vNext replacement for CAS grants.
 *
 * Implements a Three-Mode Permissioning Cascade:
 *   1. Per-action override (actions["integration:action"])
 *   2. Per-integration override (integrations["integration"])
 *   3. Org/automation default (defaultMode)
 *   4. Fallback: "auto"
 *
 * Also implements MCP tool drift detection: if a tool's structural
 * schema has changed since last seen, downgrade "auto" → "approve"
 * (but never promote "deny" — deny always wins).
 */

import { createHash } from "node:crypto";
import type { ActionMode, ActionModes } from "@proliferate/providers";

// ============================================
// Mode Resolution
// ============================================

/**
 * Resolve which ActionMode applies for a given integration:action pair.
 * Cascade: actions > integrations > defaultMode > "auto"
 */
export function resolveActionMode(
	modes: ActionModes | null | undefined,
	integration: string,
	action: string,
): ActionMode {
	if (!modes) return "auto";

	// 1. Per-action override
	const actionKey = `${integration}:${action}`;
	if (modes.actions?.[actionKey]) return modes.actions[actionKey];

	// 2. Per-integration override
	if (modes.integrations?.[integration]) return modes.integrations[integration];

	// 3. Default mode
	return modes.defaultMode ?? "auto";
}

/**
 * Given a resolved mode and risk level, determine the action disposition.
 * Returns the status the invocation should start with.
 *
 * If driftDetected is true and mode is "auto", downgrades to "approve"
 * (requires approval). "deny" is never changed — deny always wins.
 */
export function evaluateActionApproval(
	mode: ActionMode,
	riskLevel: "read" | "write" | "danger",
	driftDetected = false,
): "approved" | "pending" | "denied" {
	// Deny always wins — never escalate
	if (mode === "deny") return "denied";

	// Approve mode — always require approval regardless of risk
	if (mode === "approve") return "pending";

	// Auto mode — risk-based with drift downgrade
	if (riskLevel === "danger") return "denied";
	if (riskLevel === "read" && !driftDetected) return "approved";

	// Write in auto, or read with drift
	if (driftDetected) return "pending";
	return "approved";
}

// ============================================
// MCP Tool Drift Detection
// ============================================

/**
 * Compute a deterministic hash of a tool's schema for drift detection.
 * Strips cosmetic-only fields (enum, default, description) before hashing
 * so that documentation changes don't trigger false drift alerts.
 */
export function computeToolHash(schema: unknown): string {
	const stripped = stripCosmeticFields(schema);
	const canonical = canonicalStringify(stripped);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Check if a tool's schema has drifted from a previously stored hash.
 * Returns true if drift is detected (schema changed).
 */
export function detectDrift(currentSchema: unknown, previousHash: string | null): boolean {
	if (!previousHash) return false;
	return computeToolHash(currentSchema) !== previousHash;
}

// ============================================
// Internal Helpers
// ============================================

/**
 * Recursively strip cosmetic-only JSON Schema fields that should not
 * affect the structural hash. These fields are purely documentation:
 * enum (value hints), default (example values), description (docs).
 */
function stripCosmeticFields(obj: unknown): unknown {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj !== "object") return obj;
	if (Array.isArray(obj)) return obj.map(stripCosmeticFields);

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
		if (key === "enum" || key === "default" || key === "description") continue;
		result[key] = stripCosmeticFields(value);
	}
	return result;
}

/**
 * Deterministic JSON stringifier — sorts object keys at every level
 * to ensure consistent hashing regardless of property insertion order.
 */
function canonicalStringify(value: unknown): string {
	if (value === null || value === undefined) return JSON.stringify(value);
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(canonicalStringify).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
	return `{${entries.join(",")}}`;
}
