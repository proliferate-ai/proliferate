/**
 * Actions service.
 *
 * Business logic for agent-initiated external actions.
 * vNext: uses Three-Mode Permissioning Cascade (replaces CAS grants).
 */

import type { ActionModes } from "@proliferate/providers";
import { getServicesLogger } from "../logger";
import type { ActionInvocationRow, ActionInvocationWithSession } from "./db";
import * as actionsDb from "./db";
import { evaluateActionApproval, resolveActionMode } from "./modes";

// ============================================
// Error Classes
// ============================================

export class ActionNotFoundError extends Error {
	constructor(message = "Invocation not found") {
		super(message);
		this.name = "ActionNotFoundError";
	}
}

export class ActionExpiredError extends Error {
	constructor(message = "Invocation has expired") {
		super(message);
		this.name = "ActionExpiredError";
	}
}

export class ActionConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ActionConflictError";
	}
}

export class PendingLimitError extends Error {
	constructor(message = "Too many pending approvals. Resolve existing ones first.") {
		super(message);
		this.name = "PendingLimitError";
	}
}

const PENDING_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes for approval timeout
const MAX_PENDING_PER_SESSION = 10;
const MAX_RESULT_SIZE = 10 * 1024; // 10KB max for stored results
const SENSITIVE_KEYS = new Set([
	"token",
	"secret",
	"password",
	"authorization",
	"api_key",
	"apikey",
]);

// ============================================
// Redaction
// ============================================

/** Strip sensitive fields before storing in DB. */
function redactData(data: unknown): unknown {
	if (data === null || data === undefined) return data;
	if (typeof data !== "object") return data;
	if (Array.isArray(data)) return data.map(redactData);

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
		if (SENSITIVE_KEYS.has(key.toLowerCase())) {
			result[key] = "[REDACTED]";
		} else {
			result[key] = redactData(value);
		}
	}
	return result;
}

// ============================================
// JSON-Aware Truncation
// ============================================

/**
 * Truncate action result data while preserving valid JSON structure.
 * Instead of blindly slicing a serialized string, prunes structurally:
 *   - Arrays are truncated to fit within the budget
 *   - Strings are sliced with an ellipsis marker
 *   - Objects keep their keys but prune nested values
 *   - Primitives pass through unchanged
 *
 * Returns the original data if it fits within MAX_RESULT_SIZE.
 */
function truncateResult(data: unknown): unknown {
	if (data === null || data === undefined) return data;
	const serialized = JSON.stringify(data);
	if (serialized.length <= MAX_RESULT_SIZE) return data;

	return pruneToFit(data, MAX_RESULT_SIZE);
}

/**
 * Recursively prune a value to fit within a byte budget.
 * Preserves structure so the output is always valid JSON.
 */
function pruneToFit(value: unknown, budget: number): unknown {
	if (value === null || value === undefined) return value;

	if (typeof value === "string") {
		if (value.length + 2 <= budget) return value; // +2 for JSON quotes
		const maxLen = Math.max(0, budget - 20); // room for quotes + ellipsis marker
		return `${value.slice(0, maxLen)}… [truncated]`;
	}

	if (typeof value !== "object") return value;

	if (Array.isArray(value)) {
		return pruneArray(value, budget);
	}

	return pruneObject(value as Record<string, unknown>, budget);
}

function pruneArray(arr: unknown[], budget: number): unknown {
	// Envelope: [ ... , {"_truncated": true, "_originalLength": N} ]
	const truncMarker = { _truncated: true, _originalLength: arr.length };
	const markerSize = JSON.stringify(truncMarker).length + 1; // +1 for comma

	let used = 2; // opening [ and closing ]
	const result: unknown[] = [];

	for (const item of arr) {
		const itemJson = JSON.stringify(item);
		const itemCost = itemJson.length + (result.length > 0 ? 1 : 0); // comma

		if (used + itemCost + markerSize > budget) {
			// No more room — append truncation marker
			result.push(truncMarker);
			return result;
		}

		result.push(item);
		used += itemCost;
	}

	return result; // Everything fit
}

function pruneObject(obj: Record<string, unknown>, budget: number): unknown {
	let used = 2; // { }
	const result: Record<string, unknown> = {};
	const entries = Object.entries(obj);
	let truncated = false;

	for (const [key, value] of entries) {
		const keySize = JSON.stringify(key).length + 1; // +1 for colon
		const valueBudget = budget - used - keySize - 1; // -1 for comma

		if (valueBudget <= 0) {
			truncated = true;
			break;
		}

		const valueJson = JSON.stringify(value);
		if (valueJson.length <= valueBudget) {
			result[key] = value;
			used += keySize + valueJson.length + (Object.keys(result).length > 1 ? 1 : 0);
		} else {
			// Prune the value to fit
			result[key] = pruneToFit(value, valueBudget);
			used +=
				keySize + JSON.stringify(result[key]).length + (Object.keys(result).length > 1 ? 1 : 0);
			truncated = true;
			break;
		}
	}

	if (truncated) {
		result._truncated = true;
	}

	return result;
}

// ============================================
// Types
// ============================================

export type ActionStatus =
	| "pending"
	| "approved"
	| "executing"
	| "completed"
	| "denied"
	| "failed"
	| "expired";

export interface InvokeActionInput {
	sessionId: string;
	organizationId: string;
	integrationId: string | null;
	integration: string;
	action: string;
	riskLevel: "read" | "write" | "danger";
	params: unknown;
	/** vNext: action modes for mode-based resolution. */
	modes?: ActionModes | null;
	/** vNext: whether MCP tool schema drift was detected. */
	driftDetected?: boolean;
}

export interface InvokeActionResult {
	invocation: ActionInvocationRow;
	/** Whether the action needs user approval before execution */
	needsApproval: boolean;
}

// ============================================
// Service Functions
// ============================================

/**
 * Create an action invocation using the Three-Mode Permissioning Cascade.
 *
 * Resolution order:
 *   1. Per-action override (modes.actions["integration:action"])
 *   2. Per-integration override (modes.integrations["integration"])
 *   3. Org/automation default (modes.defaultMode)
 *   4. Fallback: "auto" (risk-based)
 *
 * In "auto" mode: reads auto-approve, writes auto-approve, danger denied.
 * Drift detection downgrades auto → pending (requires approval).
 */
export async function invokeAction(input: InvokeActionInput): Promise<InvokeActionResult> {
	const log = getServicesLogger().child({ module: "actions" });

	const mode = resolveActionMode(input.modes, input.integration, input.action);
	const disposition = evaluateActionApproval(mode, input.riskLevel, input.driftDetected);

	if (disposition === "denied") {
		const invocation = await actionsDb.createInvocation({
			...input,
			status: "denied",
		});
		log.info(
			{ invocationId: invocation.id, action: input.action, mode, riskLevel: input.riskLevel },
			"Action denied",
		);
		return { invocation, needsApproval: false };
	}

	if (disposition === "approved") {
		const invocation = await actionsDb.createInvocation({
			...input,
			status: "approved",
		});
		log.info(
			{ invocationId: invocation.id, action: input.action, mode, riskLevel: input.riskLevel },
			"Action auto-approved",
		);
		return { invocation, needsApproval: false };
	}

	// disposition === "pending" — enforce pending cap
	const pending = await actionsDb.listPendingBySession(input.sessionId);
	if (pending.length >= MAX_PENDING_PER_SESSION) {
		throw new PendingLimitError();
	}

	const expiresAt = new Date(Date.now() + PENDING_EXPIRY_MS);
	const invocation = await actionsDb.createInvocation({
		...input,
		status: "pending",
		expiresAt,
	});
	log.info(
		{
			invocationId: invocation.id,
			action: input.action,
			mode,
			driftDetected: input.driftDetected,
		},
		"Action pending approval",
	);
	return { invocation, needsApproval: true };
}

/**
 * Mark an invocation as executing (before calling the adapter).
 */
export async function markExecuting(
	invocationId: string,
): Promise<ActionInvocationRow | undefined> {
	return actionsDb.updateInvocationStatus(invocationId, "executing");
}

/**
 * Mark an invocation as completed with result.
 */
export async function markCompleted(
	invocationId: string,
	result: unknown,
	durationMs: number,
): Promise<ActionInvocationRow | undefined> {
	return actionsDb.updateInvocationStatus(invocationId, "completed", {
		result: truncateResult(redactData(result)),
		completedAt: new Date(),
		durationMs,
	});
}

/**
 * Mark an invocation as failed.
 */
export async function markFailed(
	invocationId: string,
	error: string,
	durationMs?: number,
): Promise<ActionInvocationRow | undefined> {
	return actionsDb.updateInvocationStatus(invocationId, "failed", {
		error,
		completedAt: new Date(),
		durationMs,
	});
}

/**
 * Approve a pending invocation.
 */
export async function approveAction(
	invocationId: string,
	orgId: string,
	userId: string,
): Promise<ActionInvocationRow> {
	const invocation = await actionsDb.getInvocation(invocationId, orgId);
	if (!invocation) {
		throw new ActionNotFoundError();
	}
	if (invocation.status !== "pending") {
		throw new ActionConflictError(`Cannot approve invocation in status: ${invocation.status}`);
	}
	if (invocation.expiresAt && invocation.expiresAt <= new Date()) {
		await actionsDb.updateInvocationStatus(invocationId, "expired", {
			completedAt: new Date(),
		});
		throw new ActionExpiredError();
	}

	const updated = await actionsDb.updateInvocationStatus(invocationId, "approved", {
		approvedBy: userId,
		approvedAt: new Date(),
	});
	if (!updated) {
		throw new ActionConflictError("Failed to update invocation");
	}
	return updated;
}

/**
 * Deny a pending invocation.
 */
export async function denyAction(
	invocationId: string,
	orgId: string,
	userId: string,
): Promise<ActionInvocationRow> {
	const invocation = await actionsDb.getInvocation(invocationId, orgId);
	if (!invocation) {
		throw new ActionNotFoundError();
	}
	if (invocation.status !== "pending") {
		throw new ActionConflictError(`Cannot deny invocation in status: ${invocation.status}`);
	}

	const updated = await actionsDb.updateInvocationStatus(invocationId, "denied", {
		approvedBy: userId,
		completedAt: new Date(),
	});
	if (!updated) {
		throw new ActionConflictError("Failed to update invocation");
	}
	return updated;
}

/**
 * Get the current status of an invocation.
 */
export async function getActionStatus(
	invocationId: string,
	orgId: string,
): Promise<ActionInvocationRow | undefined> {
	return actionsDb.getInvocation(invocationId, orgId);
}

/**
 * List all invocations for a session.
 */
export async function listSessionActions(sessionId: string): Promise<ActionInvocationRow[]> {
	return actionsDb.listBySession(sessionId);
}

/**
 * List pending invocations for a session.
 */
export async function listPendingActions(sessionId: string): Promise<ActionInvocationRow[]> {
	return actionsDb.listPendingBySession(sessionId);
}

/**
 * Expire stale pending invocations (called by worker sweeper).
 */
export async function expireStaleInvocations(): Promise<number> {
	return actionsDb.expirePendingInvocations(new Date());
}

/**
 * List invocations for an org with optional status filter + pagination.
 * Used by the org-level dashboard inbox.
 */
export async function listOrgActions(
	orgId: string,
	options?: { status?: string; limit?: number; offset?: number },
): Promise<{ invocations: ActionInvocationWithSession[]; total: number }> {
	const [invocations, total] = await Promise.all([
		actionsDb.listByOrg(orgId, options),
		actionsDb.countByOrg(orgId, options?.status),
	]);
	return { invocations, total };
}
