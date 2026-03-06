/**
 * Actions service.
 *
 * Business logic for agent-initiated external actions.
 */

import { truncateJson } from "@proliferate/providers/helpers/truncation";
import type { ActionInvocationStatus, CapabilityMode } from "@proliferate/shared/contracts/actions";
import { getServicesLogger } from "../logger";
import type {
	ActionInvocationRow,
	ActionInvocationWithSession,
	CreateInvocationInput,
	ResumeIntentRow,
} from "./db";

// Re-exported DB row types (service DTO boundary)
export type { ActionInvocationRow, ActionInvocationWithSession, CreateInvocationInput };
import * as actionsDb from "./db";
export {
	ActionConflictError,
	ActionExpiredError,
	ActionNotFoundError,
	ApprovalAuthorityError,
	PendingLimitError,
} from "./errors";
import { getDisabledPreferences } from "../user-action-preferences";
import {
	ActionConflictError,
	ActionExpiredError,
	ActionNotFoundError,
	ApprovalAuthorityError,
	PendingLimitError,
} from "./errors";
import { resolveMode } from "./modes";

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

export interface ActionExecutionOutput {
	success: boolean;
	data?: unknown;
	error?: string;
}

export interface ExecuteApprovedInvocationInput {
	invocationId: string;
	execute: () => Promise<ActionExecutionOutput>;
}

export interface ExecuteApprovedInvocationResult {
	invocation: ActionInvocationRow;
	result: unknown;
}

export interface AvailableActionCatalogAction {
	name: string;
	riskLevel: "read" | "write" | "danger";
}

export interface AvailableActionCatalogIntegration<TAction extends AvailableActionCatalogAction> {
	integrationId: string | null;
	integration: string;
	displayName: string | null;
	actions: TAction[];
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
	capabilityMode?: CapabilityMode;
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

async function buildResumeIntentPayload(input: {
	invocation: ActionInvocationRow;
	terminalStatus: "completed" | "failed" | "denied" | "expired";
}): Promise<unknown | undefined> {
	if (input.invocation.mode !== "require_approval") {
		return undefined;
	}

	const session = await actionsDb.getSessionApprovalContext(input.invocation.sessionId);
	if (!session) {
		return undefined;
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

	return {
		terminalStatus: input.terminalStatus,
		strategy: "same_session_first",
		fallback: "continuation",
		revalidation: {
			liveMode: liveMode.mode,
			liveModeSource: liveMode.source,
			capabilityMode: capabilityMode ?? null,
			integrationAvailable: null,
		},
	};
}

function resumeIntentArg(payload: unknown | undefined): { payloadJson?: unknown } | undefined {
	if (payload === undefined) {
		return undefined;
	}
	return { payloadJson: payload };
}

// ============================================
// Transactional Transition with Side Effects
// ============================================

export interface TransitionInvocationWithEffectsInput {
	id: string;
	fromStatuses: ActionInvocationStatus[];
	toStatus: ActionInvocationStatus;
	data?: {
		result?: unknown;
		error?: string;
		approvedBy?: string;
		approvedAt?: Date;
		completedAt?: Date;
		durationMs?: number;
		deniedReason?: string;
		expiresAt?: Date | null;
	};
	event?: {
		eventType: string;
		actorUserId?: string | null;
		payloadJson?: unknown;
	};
	resumeIntent?: {
		payloadJson?: unknown;
	};
}

export interface TransitionInvocationWithEffectsResult {
	invocation: ActionInvocationRow | undefined;
	resumeIntent: ResumeIntentRow | undefined;
}

/**
 * Atomically transition an invocation status and apply side effects:
 *   1. Update invocation status (CAS guard on fromStatuses)
 *   2. Insert an invocation event
 *   3. Touch session lastVisibleUpdateAt for approval-resolution statuses
 *   4. Conditionally create a resume intent when the session is waiting_for_approval
 *
 * All writes happen inside a single DB transaction.
 */
async function transitionInvocationWithEffects(
	input: TransitionInvocationWithEffectsInput,
): Promise<TransitionInvocationWithEffectsResult> {
	if (input.fromStatuses.length === 0) {
		throw new Error("fromStatuses must include at least one status");
	}

	return actionsDb.withTransaction(async (tx) => {
		const invocation = await actionsDb.transitionInvocationStatusTx(
			tx,
			input.id,
			input.fromStatuses,
			input.toStatus,
			input.data,
		);

		if (!invocation) {
			return { invocation: undefined, resumeIntent: undefined };
		}

		if (input.event) {
			await actionsDb.insertInvocationEventTx(tx, invocation.id, input.event);
		}

		if (actionsDb.APPROVAL_RESOLUTION_STATUSES.has(input.toStatus)) {
			await actionsDb.touchSessionLastVisibleUpdate(tx, invocation.sessionId);
		}

		let resumeIntent: ResumeIntentRow | undefined;
		if (input.resumeIntent && invocation.mode === "require_approval") {
			const operatorStatus = await actionsDb.getSessionOperatorStatusTx(tx, invocation.sessionId);

			if (operatorStatus === "waiting_for_approval") {
				const existing = await actionsDb.findActiveResumeIntentTx(
					tx,
					invocation.sessionId,
					invocation.id,
				);

				if (existing) {
					resumeIntent = existing;
				} else {
					try {
						resumeIntent = await actionsDb.insertResumeIntentTx(tx, {
							originSessionId: invocation.sessionId,
							invocationId: invocation.id,
							payloadJson: input.resumeIntent.payloadJson,
						});
					} catch (error) {
						if (!actionsDb.isDuplicateActiveResumeIntentError(error)) {
							throw error;
						}

						const retried = await actionsDb.findActiveResumeIntentTx(
							tx,
							invocation.sessionId,
							invocation.id,
						);
						if (!retried) {
							throw error;
						}
						resumeIntent = retried;
					}
				}
			}
		}

		return { invocation, resumeIntent };
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
			await actionsDb.createActionInvocationEvent({
				actionInvocationId: invocation.id,
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
			await actionsDb.createActionInvocationEvent({
				actionInvocationId: invocation.id,
				eventType: "approved",
			});
			log.info(
				{ invocationId: invocation.id, action: input.action, modeSource: effective.modeSource },
				"Action auto-approved",
			);
			return { invocation, needsApproval: false };
		}

		case "require_approval": {
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
			await actionsDb.createActionInvocationEvent({
				actionInvocationId: invocation.id,
				eventType: "pending",
				payloadJson: {
					expiresAt: expiresAt.toISOString(),
					capabilityKey: effective.capabilityKey,
					capabilityMode: effective.capabilityMode ?? null,
				},
			});
			await actionsDb.setSessionOperatorStatus({
				sessionId: input.sessionId,
				toStatus: "waiting_for_approval",
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
 * Used by tool discovery to hide capabilities that resolve to deny.
 */
export async function isActionDeniedForSession(input: {
	sessionId: string;
	organizationId: string;
	integration: string;
	action: string;
	riskLevel: "read" | "write" | "danger";
	automationId?: string;
	isDrifted?: boolean;
	capabilityKey?: string;
}): Promise<boolean> {
	const resolved = await resolveEffectiveMode(input);
	return resolved.effectiveMode === "deny";
}

/**
 * Filter action catalog visibility for a session.
 *
 * Applies user disabled-source preferences first, then policy filtering.
 */
export async function filterAvailableActionsForSession<
	TAction extends AvailableActionCatalogAction,
>(input: {
	sessionId: string;
	organizationId: string;
	automationId?: string;
	userId?: string | null;
	integrations: AvailableActionCatalogIntegration<TAction>[];
}): Promise<AvailableActionCatalogIntegration<TAction>[]> {
	const disabledPreferences =
		input.userId && input.organizationId
			? await getDisabledPreferences(input.userId, input.organizationId)
			: {
					disabledSourceIds: new Set<string>(),
					disabledActionsBySource: new Map<string, Set<string>>(),
				};
	const preferenceFiltered =
		disabledPreferences.disabledSourceIds.size > 0
			? input.integrations.filter(
					(entry) => !disabledPreferences.disabledSourceIds.has(entry.integration),
				)
			: input.integrations;

	const filtered: AvailableActionCatalogIntegration<TAction>[] = [];
	for (const integrationEntry of preferenceFiltered) {
		const disabledActions = disabledPreferences.disabledActionsBySource.get(
			integrationEntry.integration,
		);
		const visibleActions: TAction[] = [];
		for (const actionEntry of integrationEntry.actions) {
			if (disabledActions?.has(actionEntry.name)) {
				continue;
			}

			const denied = await isActionDeniedForSession({
				sessionId: input.sessionId,
				organizationId: input.organizationId,
				integration: integrationEntry.integration,
				action: actionEntry.name,
				riskLevel: actionEntry.riskLevel,
				automationId: input.automationId,
			});
			if (!denied) {
				visibleActions.push(actionEntry);
			}
		}
		if (visibleActions.length > 0) {
			filtered.push({ ...integrationEntry, actions: visibleActions });
		}
	}

	return filtered;
}

/**
 * Mark an invocation as executing (before calling the adapter).
 */
export async function markExecuting(
	invocationId: string,
): Promise<ActionInvocationRow | undefined> {
	const { invocation } = await transitionInvocationWithEffects({
		id: invocationId,
		fromStatuses: ["approved"],
		toStatus: "executing",
		event: { eventType: "executing" },
	});
	return invocation;
}

/**
 * Mark an invocation as completed with result.
 */
export async function markCompleted(
	invocationId: string,
	result: unknown,
	durationMs: number,
): Promise<ActionInvocationRow | undefined> {
	const existing = await actionsDb.getInvocationById(invocationId);
	const resumePayload = existing
		? await buildResumeIntentPayload({
				invocation: existing,
				terminalStatus: "completed",
			})
		: undefined;

	const { invocation } = await transitionInvocationWithEffects({
		id: invocationId,
		fromStatuses: ["executing"],
		toStatus: "completed",
		data: {
			result: truncateResult(redactData(result)),
			completedAt: new Date(),
			durationMs,
		},
		event: { eventType: "completed" },
		resumeIntent: resumeIntentArg(resumePayload),
	});
	return invocation;
}

/**
 * Mark an invocation as failed.
 */
export async function markFailed(
	invocationId: string,
	error: string,
	durationMs?: number,
): Promise<ActionInvocationRow | undefined> {
	const existing = await actionsDb.getInvocationById(invocationId);
	const resumePayload = existing
		? await buildResumeIntentPayload({
				invocation: existing,
				terminalStatus: "failed",
			})
		: undefined;

	const { invocation } = await transitionInvocationWithEffects({
		id: invocationId,
		fromStatuses: ["approved", "executing"],
		toStatus: "failed",
		data: {
			error,
			completedAt: new Date(),
			durationMs,
		},
		event: {
			eventType: "failed",
			payloadJson: { error },
		},
		resumeIntent: resumeIntentArg(resumePayload),
	});
	return invocation;
}

/**
 * Execute an approved invocation through a provided action executor.
 *
 * This keeps execution lifecycle orchestration in the service layer.
 */
export async function executeApprovedInvocation(
	input: ExecuteApprovedInvocationInput,
): Promise<ExecuteApprovedInvocationResult> {
	const log = getServicesLogger().child({ module: "actions", invocationId: input.invocationId });
	const executing = await markExecuting(input.invocationId);
	if (!executing) {
		throw new ActionConflictError("Invocation is not in an approvable state for execution");
	}

	const startedAt = Date.now();
	try {
		const actionResult = await input.execute();
		if (!actionResult.success) {
			throw new Error(actionResult.error ?? "Action failed");
		}

		const completed = await markCompleted(
			input.invocationId,
			actionResult.data,
			Date.now() - startedAt,
		);
		if (!completed) {
			throw new ActionConflictError("Failed to mark invocation as completed");
		}

		return {
			invocation: completed,
			result: completed.result,
		};
	} catch (error) {
		const durationMs = Date.now() - startedAt;
		const errorMessage = error instanceof Error ? error.message : String(error);

		try {
			await markFailed(input.invocationId, errorMessage, durationMs);
		} catch (markFailedError) {
			log.error(
				{ error: markFailedError },
				"Failed to persist action failure after execution error",
			);
		}

		throw new Error(errorMessage);
	}
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
		const resumePayload = await buildResumeIntentPayload({
			invocation,
			terminalStatus: "expired",
		});
		await transitionInvocationWithEffects({
			id: invocationId,
			fromStatuses: ["pending"],
			toStatus: "expired",
			data: { completedAt: now },
			event: { eventType: "expired" },
			resumeIntent: resumeIntentArg(resumePayload),
		});
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
		const resumePayload = await buildResumeIntentPayload({
			invocation,
			terminalStatus: "denied",
		});
		const { invocation: denied } = await transitionInvocationWithEffects({
			id: invocationId,
			fromStatuses: ["pending"],
			toStatus: "denied",
			data: {
				deniedReason: "policy_revalidated_deny",
				completedAt: now,
			},
			event: {
				eventType: "denied",
				actorUserId: userId,
				payloadJson: { reason: "policy_revalidated_deny" },
			},
			resumeIntent: resumeIntentArg(resumePayload),
		});

		if (!denied) {
			throw new ActionConflictError("Failed to update invocation");
		}
		throw new ActionConflictError("Invocation denied by current policy");
	}

	const { invocation: approved } = await transitionInvocationWithEffects({
		id: invocationId,
		fromStatuses: ["pending"],
		toStatus: "approved",
		data: {
			approvedBy: userId,
			approvedAt: now,
		},
		event: { eventType: "approved", actorUserId: userId },
	});
	if (!approved) {
		throw new ActionConflictError("Failed to update invocation");
	}

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

	const resumePayload = await buildResumeIntentPayload({
		invocation,
		terminalStatus: "denied",
	});
	const { invocation: updated } = await transitionInvocationWithEffects({
		id: invocationId,
		fromStatuses: ["pending"],
		toStatus: "denied",
		data: {
			completedAt: new Date(),
		},
		event: {
			eventType: "denied",
			actorUserId: userId,
		},
		resumeIntent: resumeIntentArg(resumePayload),
	});
	if (!updated) {
		throw new ActionConflictError("Failed to update invocation");
	}

	return updated;
}

/**
 * Verify session visibility + ACL-based authority for approval decisions.
 */
export async function assertApprovalAuthority(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
	isOrgAdmin: boolean;
}): Promise<void> {
	const session = await actionsDb.getSessionApprovalContext(input.sessionId);
	if (!session || session.organizationId !== input.organizationId) {
		throw new ApprovalAuthorityError("Session access denied");
	}

	if (session.createdBy === input.userId) {
		return;
	}

	if (input.isOrgAdmin) {
		return;
	}

	const aclRole = await actionsDb.getSessionAclRole(input.sessionId, input.userId);
	if (aclRole !== "reviewer") {
		throw new ApprovalAuthorityError(
			"Approval authority requires reviewer ACL grant or org-admin override",
		);
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
		const resumePayload = await buildResumeIntentPayload({
			invocation,
			terminalStatus: "expired",
		});
		const { invocation: expired } = await transitionInvocationWithEffects({
			id: invocation.id,
			fromStatuses: ["pending"],
			toStatus: "expired",
			data: { completedAt: now },
			event: { eventType: "expired" },
			resumeIntent: resumeIntentArg(resumePayload),
		});
		if (!expired) {
			continue;
		}
		expiredCount += 1;
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

export interface ActionInvocationTransport
	extends Omit<
		ActionInvocationWithSession,
		"approvedAt" | "completedAt" | "expiresAt" | "createdAt"
	> {
	approvedAt: string | null;
	completedAt: string | null;
	expiresAt: string | null;
	createdAt: string | null;
}

/**
 * List org actions with transport-safe ISO timestamp fields.
 */
export async function listOrgActionsForTransport(
	orgId: string,
	options?: { status?: string; limit?: number; offset?: number },
): Promise<{ invocations: ActionInvocationTransport[]; total: number }> {
	const { invocations, total } = await listOrgActions(orgId, options);
	return {
		invocations: invocations.map((row) => ({
			...row,
			approvedAt: row.approvedAt?.toISOString() ?? null,
			completedAt: row.completedAt?.toISOString() ?? null,
			expiresAt: row.expiresAt?.toISOString() ?? null,
			createdAt: row.createdAt?.toISOString() ?? null,
		})),
		total,
	};
}
