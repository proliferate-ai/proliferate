/**
 * Actions service.
 *
 * Business logic for agent-initiated external actions.
 */

import { truncateJson } from "@proliferate/providers/helpers/truncation";
import { getServicesLogger } from "../logger";
import type { ActionInvocationRow, ActionInvocationWithSession } from "./db";
import * as actionsDb from "./db";
import { resolveMode } from "./modes";

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

/** Strip sensitive fields and truncate large values before storing in DB. */
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

/** Truncate result using JSON-aware structural pruning. */
function truncateResult(data: unknown): unknown {
	return truncateJson(data, MAX_RESULT_SIZE);
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
	/** Automation ID for mode resolution (unattended runs) */
	automationId?: string;
	/** Whether this tool has drifted from last admin review (connector tools) */
	isDrifted?: boolean;
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
 * Mode resolution: automation override → org default → inferred from risk hint.
 * Drift guard: if a connector tool has drifted, `allow` downgrades to `require_approval`.
 */
export async function invokeAction(input: InvokeActionInput): Promise<InvokeActionResult> {
	const log = getServicesLogger().child({ module: "actions" });

	// Resolve mode via the three-tier cascade
	const { mode, source: modeSource } = await resolveMode({
		sourceId: input.integration,
		actionId: input.action,
		riskLevel: input.riskLevel,
		orgId: input.organizationId,
		automationId: input.automationId,
		isDrifted: input.isDrifted,
	});

	const baseInput = {
		sessionId: input.sessionId,
		organizationId: input.organizationId,
		integrationId: input.integrationId,
		integration: input.integration,
		action: input.action,
		riskLevel: input.riskLevel,
		params: input.params,
		mode,
		modeSource,
	};

	switch (mode) {
		case "deny": {
			const invocation = await actionsDb.createInvocation({
				...baseInput,
				status: "denied",
				deniedReason: "policy",
			});
			log.info(
				{ invocationId: invocation.id, action: input.action, modeSource },
				"Action denied by policy",
			);
			return { invocation, needsApproval: false };
		}

		case "allow": {
			const invocation = await actionsDb.createInvocation({
				...baseInput,
				status: "approved",
			});
			log.info(
				{ invocationId: invocation.id, action: input.action, modeSource },
				"Action auto-approved",
			);
			return { invocation, needsApproval: false };
		}

		case "require_approval": {
			// Enforce pending cap before creating pending invocation
			const pending = await actionsDb.listPendingBySession(input.sessionId);
			if (pending.length >= MAX_PENDING_PER_SESSION) {
				throw new PendingLimitError();
			}

			const expiresAt = new Date(Date.now() + PENDING_EXPIRY_MS);
			const invocation = await actionsDb.createInvocation({
				...baseInput,
				status: "pending",
				expiresAt,
			});
			log.info(
				{ invocationId: invocation.id, action: input.action, modeSource },
				"Action pending approval",
			);
			return { invocation, needsApproval: true };
		}

		default: {
			// Unknown mode from JSONB — deny as a safe fallback
			const invocation = await actionsDb.createInvocation({
				...baseInput,
				status: "denied",
				deniedReason: `unknown_mode:${mode}`,
			});
			log.warn(
				{ invocationId: invocation.id, action: input.action, mode },
				"Action denied — unknown mode from JSONB",
			);
			return { invocation, needsApproval: false };
		}
	}
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
