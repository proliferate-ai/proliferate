/**
 * Actions service.
 *
 * Business logic for agent-initiated external actions.
 */

import { getServicesLogger } from "../logger";
import type { ActionInvocationRow, ActionInvocationWithSession } from "./db";
import * as actionsDb from "./db";
import * as grantsService from "./grants";
import type { ActionGrantRow } from "./grants-db";

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

/** Truncate result if serialized form exceeds max size. */
function truncateResult(data: unknown): unknown {
	if (data === null || data === undefined) return data;
	const serialized = JSON.stringify(data);
	if (serialized.length <= MAX_RESULT_SIZE) return data;
	return { _truncated: true, _originalSize: serialized.length };
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
 * Create an action invocation. Reads are auto-approved; writes are pending.
 */
export async function invokeAction(input: InvokeActionInput): Promise<InvokeActionResult> {
	const log = getServicesLogger().child({ module: "actions" });

	if (input.riskLevel === "danger") {
		const invocation = await actionsDb.createInvocation({
			...input,
			status: "denied",
		});
		log.info({ invocationId: invocation.id, action: input.action }, "Action denied (danger)");
		return { invocation, needsApproval: false };
	}

	if (input.riskLevel === "read") {
		const invocation = await actionsDb.createInvocation({
			...input,
			status: "approved",
		});
		log.info({ invocationId: invocation.id, action: input.action }, "Action auto-approved (read)");
		return { invocation, needsApproval: false };
	}

	// Write actions — check for a matching grant before requiring approval
	const grantResult = await grantsService.evaluateGrant(
		input.organizationId,
		input.integration,
		input.action,
		input.sessionId,
	);

	if (grantResult.granted) {
		const invocation = await actionsDb.createInvocation({
			...input,
			status: "approved",
		});
		log.info(
			{
				invocationId: invocation.id,
				action: input.action,
				grantId: grantResult.grantId,
			},
			"Action auto-approved via grant (write)",
		);
		return { invocation, needsApproval: false };
	}

	// No matching grant — enforce pending cap before creating pending invocation
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
		{ invocationId: invocation.id, action: input.action },
		"Action pending approval (write)",
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
 * Approve a pending invocation and create a scoped grant for future similar actions.
 */
export interface ApproveWithGrantInput {
	scope: "session" | "org";
	maxCalls?: number | null;
}

export async function approveActionWithGrant(
	invocationId: string,
	orgId: string,
	userId: string,
	grantInput: ApproveWithGrantInput,
): Promise<{ invocation: ActionInvocationRow; grant: ActionGrantRow }> {
	const log = getServicesLogger().child({ module: "actions" });

	// 1. Validate invocation (same checks as approveAction)
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

	// 2. Create the grant (derives integration+action from invocation)
	const grant = await grantsService.createGrant({
		organizationId: orgId,
		createdBy: userId,
		sessionId: grantInput.scope === "session" ? invocation.sessionId : undefined,
		integration: invocation.integration,
		action: invocation.action,
		maxCalls: grantInput.maxCalls ?? null,
	});

	// 3. Approve the invocation — rollback grant on failure
	try {
		const updated = await actionsDb.updateInvocationStatus(invocationId, "approved", {
			approvedBy: userId,
			approvedAt: new Date(),
		});
		if (!updated) {
			await grantsService.revokeGrant(grant.id, orgId);
			throw new ActionConflictError("Failed to update invocation");
		}
		log.info(
			{ invocationId, grantId: grant.id, scope: grantInput.scope },
			"Invocation approved with grant",
		);
		return { invocation: updated, grant };
	} catch (err) {
		// Best-effort rollback — grant is useless without the approval
		await grantsService.revokeGrant(grant.id, orgId).catch(() => undefined);
		throw err;
	}
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
