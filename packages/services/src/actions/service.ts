/**
 * Actions service.
 *
 * Business logic for agent-initiated external actions.
 */

import { truncateJson } from "@proliferate/providers/helpers/truncation";
import { getServicesLogger } from "../logger";
import type {
	ActionInvocationRow,
	ActionInvocationStatus,
	ActionInvocationWithSession,
	SessionCapabilityMode,
} from "./db";
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

export class ApprovalAuthorityError extends Error {
	constructor(message = "You do not have approval authority for this session") {
		super(message);
		this.name = "ApprovalAuthorityError";
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

const MODE_PRIORITY: Record<"allow" | "require_approval" | "deny", number> = {
	allow: 1,
	require_approval: 2,
	deny: 3,
};

const WAITING_FOR_APPROVAL_STATUS = "waiting_for_approval";

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

export type ActionStatus = ActionInvocationStatus;

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
	/** Optional explicit capability key; defaults to `${integration}.${action}`. */
	capabilityKey?: string;
}

export interface InvokeActionResult {
	invocation: ActionInvocationRow;
	/** Whether the action needs user approval before execution */
	needsApproval: boolean;
}

function parseMode(value: string | null | undefined): "allow" | "require_approval" | "deny" | null {
	if (value === "allow" || value === "require_approval" || value === "deny") {
		return value;
	}
	return null;
}

function strictestMode(
	left: "allow" | "require_approval" | "deny",
	right: "allow" | "require_approval" | "deny",
): "allow" | "require_approval" | "deny" {
	return MODE_PRIORITY[left] >= MODE_PRIORITY[right] ? left : right;
}

function getCapabilityKey(input: {
	integration: string;
	action: string;
	capabilityKey?: string;
}): string {
	return input.capabilityKey ?? `${input.integration}.${input.action}`;
}

async function resolveEffectiveMode(input: {
	sessionId: string;
	organizationId: string;
	integration: string;
	action: string;
	riskLevel: "read" | "write" | "danger";
	automationId?: string;
	isDrifted?: boolean;
	capabilityKey?: string;
}): Promise<{
	effectiveMode: "allow" | "require_approval" | "deny";
	modeSource: string;
	capabilityMode?: SessionCapabilityMode;
	capabilityKey: string;
}> {
	const resolved = await resolveMode({
		sourceId: input.integration,
		actionId: input.action,
		riskLevel: input.riskLevel,
		orgId: input.organizationId,
		automationId: input.automationId,
		isDrifted: input.isDrifted,
	});

	const capabilityKey = getCapabilityKey(input);
	const capabilityMode = await actionsDb.getSessionCapabilityMode(input.sessionId, capabilityKey);

	const resolvedMode = parseMode(resolved.mode);
	if (!resolvedMode) {
		return {
			effectiveMode: "deny",
			modeSource: `unknown_mode:${resolved.mode}`,
			capabilityMode,
			capabilityKey,
		};
	}

	const effectiveMode = capabilityMode ? strictestMode(resolvedMode, capabilityMode) : resolvedMode;
	const modeSource = capabilityMode ? `${resolved.source}+session_capability` : resolved.source;

	return {
		effectiveMode,
		modeSource,
		capabilityMode,
		capabilityKey,
	};
}

async function queueResumeIntentIfNeeded(input: {
	invocation: ActionInvocationRow;
	terminalStatus: "completed" | "failed" | "denied" | "expired";
}): Promise<void> {
	if (input.invocation.mode !== "require_approval") {
		return;
	}

	const session = await actionsDb.getSessionApprovalContext(input.invocation.sessionId);
	if (!session || session.operatorStatus !== WAITING_FOR_APPROVAL_STATUS) {
		return;
	}

	const capabilityKey = getCapabilityKey({
		integration: input.invocation.integration,
		action: input.invocation.action,
	});
	const capabilityMode = await actionsDb.getSessionCapabilityMode(session.id, capabilityKey);
	const liveMode = await resolveMode({
		sourceId: input.invocation.integration,
		actionId: input.invocation.action,
		riskLevel: input.invocation.riskLevel as "read" | "write" | "danger",
		orgId: input.invocation.organizationId,
		automationId: session.automationId ?? undefined,
	});

	await actionsDb.createOrGetActiveResumeIntent({
		originSessionId: input.invocation.sessionId,
		invocationId: input.invocation.id,
		payloadJson: {
			terminalStatus: input.terminalStatus,
			strategy: "same_session_first",
			fallback: "continuation",
			revalidation: {
				liveMode: liveMode.mode,
				liveModeSource: liveMode.source,
				capabilityMode: capabilityMode ?? null,
				integrationAvailable: null,
			},
		},
	});
}

async function recordEvent(input: {
	invocationId: string;
	eventType: string;
	actorUserId?: string | null;
	payloadJson?: unknown;
}): Promise<void> {
	await actionsDb.createActionInvocationEvent({
		actionInvocationId: input.invocationId,
		eventType: input.eventType,
		actorUserId: input.actorUserId,
		payloadJson: input.payloadJson,
	});
}

// ============================================
// Service Functions
// ============================================

/**
 * Create an action invocation using the Three-Mode Permissioning Cascade.
 *
 * Mode resolution: automation override → org default → inferred from risk hint.
 * Drift guard: if a connector tool has drifted, `allow` downgrades to `require_approval`.
 * Session capability rows are authoritative at invocation time.
 */
export async function invokeAction(input: InvokeActionInput): Promise<InvokeActionResult> {
	const log = getServicesLogger().child({ module: "actions" });

	const effective = await resolveEffectiveMode({
		sessionId: input.sessionId,
		organizationId: input.organizationId,
		integration: input.integration,
		action: input.action,
		riskLevel: input.riskLevel,
		automationId: input.automationId,
		isDrifted: input.isDrifted,
		capabilityKey: input.capabilityKey,
	});

	const baseInput = {
		sessionId: input.sessionId,
		organizationId: input.organizationId,
		integrationId: input.integrationId,
		integration: input.integration,
		action: input.action,
		riskLevel: input.riskLevel,
		params: input.params,
		mode: effective.effectiveMode,
		modeSource: effective.modeSource,
	};

	switch (effective.effectiveMode) {
		case "deny": {
			const invocation = await actionsDb.createInvocation({
				...baseInput,
				status: "denied",
				deniedReason: "policy",
			});
			await recordEvent({
				invocationId: invocation.id,
				eventType: "denied",
				payloadJson: {
					reason: "policy",
					capabilityKey: effective.capabilityKey,
					capabilityMode: effective.capabilityMode ?? null,
				},
			});
			log.info(
				{ invocationId: invocation.id, action: input.action, modeSource: effective.modeSource },
				"Action denied by policy",
			);
			return { invocation, needsApproval: false };
		}

		case "allow": {
			const invocation = await actionsDb.createInvocation({
				...baseInput,
				status: "approved",
			});
			await recordEvent({ invocationId: invocation.id, eventType: "approved" });
			log.info(
				{ invocationId: invocation.id, action: input.action, modeSource: effective.modeSource },
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
			await recordEvent({
				invocationId: invocation.id,
				eventType: "pending",
				payloadJson: {
					expiresAt: expiresAt.toISOString(),
					capabilityKey: effective.capabilityKey,
					capabilityMode: effective.capabilityMode ?? null,
				},
			});
			await actionsDb.setSessionOperatorStatus({
				sessionId: input.sessionId,
				toStatus: WAITING_FOR_APPROVAL_STATUS,
			});
			log.info(
				{ invocationId: invocation.id, action: input.action, modeSource: effective.modeSource },
				"Action pending approval",
			);
			return { invocation, needsApproval: true };
		}
	}
}

/**
 * Mark an invocation as executing (before calling the adapter).
 */
export async function markExecuting(
	invocationId: string,
): Promise<ActionInvocationRow | undefined> {
	const row = await actionsDb.transitionInvocationStatus({
		id: invocationId,
		fromStatuses: ["approved"],
		toStatus: "executing",
	});
	if (row) {
		await recordEvent({ invocationId, eventType: "executing" });
	}
	return row;
}

/**
 * Mark an invocation as completed with result.
 */
export async function markCompleted(
	invocationId: string,
	result: unknown,
	durationMs: number,
): Promise<ActionInvocationRow | undefined> {
	const row = await actionsDb.transitionInvocationStatus({
		id: invocationId,
		fromStatuses: ["executing"],
		toStatus: "completed",
		data: {
			result: truncateResult(redactData(result)),
			completedAt: new Date(),
			durationMs,
		},
	});
	if (row) {
		await recordEvent({ invocationId, eventType: "completed" });
		await queueResumeIntentIfNeeded({ invocation: row, terminalStatus: "completed" });
	}
	return row;
}

/**
 * Mark an invocation as failed.
 */
export async function markFailed(
	invocationId: string,
	error: string,
	durationMs?: number,
): Promise<ActionInvocationRow | undefined> {
	const row = await actionsDb.transitionInvocationStatus({
		id: invocationId,
		fromStatuses: ["approved", "executing"],
		toStatus: "failed",
		data: {
			error,
			completedAt: new Date(),
			durationMs,
		},
	});
	if (row) {
		await recordEvent({ invocationId, eventType: "failed", payloadJson: { error } });
		await queueResumeIntentIfNeeded({ invocation: row, terminalStatus: "failed" });
	}
	return row;
}

/**
 * Approve a pending invocation.
 *
 * Revalidates live capability + policy before transition.
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

	const now = new Date();
	if (invocation.expiresAt && invocation.expiresAt <= now) {
		const expired = await actionsDb.transitionInvocationStatus({
			id: invocationId,
			fromStatuses: ["pending"],
			toStatus: "expired",
			data: { completedAt: now },
		});
		if (expired) {
			await recordEvent({ invocationId, eventType: "expired" });
			await queueResumeIntentIfNeeded({ invocation: expired, terminalStatus: "expired" });
		}
		throw new ActionExpiredError();
	}

	const session = await actionsDb.getSessionApprovalContext(invocation.sessionId);
	if (!session || session.organizationId !== orgId) {
		throw new ActionNotFoundError();
	}

	const effective = await resolveEffectiveMode({
		sessionId: invocation.sessionId,
		organizationId: invocation.organizationId,
		integration: invocation.integration,
		action: invocation.action,
		riskLevel: invocation.riskLevel as "read" | "write" | "danger",
		automationId: session.automationId ?? undefined,
	});

	if (effective.effectiveMode === "deny") {
		const denied = await actionsDb.transitionInvocationStatus({
			id: invocationId,
			fromStatuses: ["pending"],
			toStatus: "denied",
			data: {
				deniedReason: "policy_revalidated_deny",
				completedAt: now,
			},
		});
		if (denied) {
			await recordEvent({
				invocationId,
				eventType: "denied",
				actorUserId: userId,
				payloadJson: { reason: "policy_revalidated_deny" },
			});
			await queueResumeIntentIfNeeded({ invocation: denied, terminalStatus: "denied" });
		}
		throw new ActionConflictError("Invocation denied by current policy");
	}

	const approved = await actionsDb.transitionInvocationStatus({
		id: invocationId,
		fromStatuses: ["pending"],
		toStatus: "approved",
		data: {
			approvedBy: userId,
			approvedAt: now,
		},
	});
	if (!approved) {
		throw new ActionConflictError("Failed to update invocation");
	}

	await recordEvent({ invocationId, eventType: "approved", actorUserId: userId });
	return approved;
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

	const updated = await actionsDb.transitionInvocationStatus({
		id: invocationId,
		fromStatuses: ["pending"],
		toStatus: "denied",
		data: {
			approvedBy: userId,
			completedAt: new Date(),
		},
	});
	if (!updated) {
		throw new ActionConflictError("Failed to update invocation");
	}

	await recordEvent({ invocationId, eventType: "denied", actorUserId: userId });
	await queueResumeIntentIfNeeded({ invocation: updated, terminalStatus: "denied" });
	return updated;
}

/**
 * Verify session visibility + ACL-based authority for approval decisions.
 *
 * Caller should also enforce org-role gates separately.
 */
export async function assertApprovalAuthority(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
}): Promise<void> {
	const session = await actionsDb.getSessionApprovalContext(input.sessionId);
	if (!session || session.organizationId !== input.organizationId) {
		throw new ApprovalAuthorityError("Session access denied");
	}

	const aclRole = await actionsDb.getSessionAclRole(input.sessionId, input.userId);
	if (aclRole === "viewer") {
		throw new ApprovalAuthorityError("Viewer role cannot approve or deny actions");
	}

	if (session.visibility === "private" && session.createdBy !== input.userId) {
		if (aclRole !== "editor" && aclRole !== "reviewer") {
			throw new ApprovalAuthorityError("Private session approval requires explicit ACL access");
		}
	}
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
	const now = new Date();
	const candidates = await actionsDb.listExpirablePendingInvocations(now);
	let expiredCount = 0;

	for (const invocation of candidates) {
		const expired = await actionsDb.transitionInvocationStatus({
			id: invocation.id,
			fromStatuses: ["pending"],
			toStatus: "expired",
			data: { completedAt: now },
		});
		if (!expired) {
			continue;
		}
		expiredCount += 1;
		await recordEvent({ invocationId: invocation.id, eventType: "expired" });
		await queueResumeIntentIfNeeded({ invocation: expired, terminalStatus: "expired" });
	}

	return expiredCount;
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
