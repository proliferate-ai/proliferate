/**
 * Actions DB operations.
 *
 * Raw Drizzle queries for action_invocations + V1 approval event/resume helpers.
 */

import {
	type InferSelectModel,
	actionInvocationEvents,
	actionInvocations,
	and,
	desc,
	eq,
	getDb,
	inArray,
	lte,
	notInArray,
	resumeIntents,
	sessionAcl,
	sessionCapabilities,
	sessions,
	sql,
} from "../db/client";

// ============================================
// Type Exports
// ============================================

export type ActionInvocationRow = InferSelectModel<typeof actionInvocations>;
export type ActionInvocationEventRow = InferSelectModel<typeof actionInvocationEvents>;
export type ResumeIntentRow = InferSelectModel<typeof resumeIntents>;

export type ActionInvocationStatus =
	| "pending"
	| "approved"
	| "executing"
	| "completed"
	| "denied"
	| "failed"
	| "expired";

export type ResumeIntentStatus =
	| "queued"
	| "claimed"
	| "resuming"
	| "satisfied"
	| "continued"
	| "resume_failed";

export type SessionCapabilityMode = "allow" | "require_approval" | "deny";

export type ActionInvocationWithSession = ActionInvocationRow & {
	sessionTitle: string | null;
};

export interface SessionApprovalContext {
	id: string;
	organizationId: string;
	automationId: string | null;
	operatorStatus: string | null;
	visibility: string | null;
	createdBy: string | null;
	repoId: string | null;
}

const TERMINAL_RESUME_INTENT_STATUSES: ResumeIntentStatus[] = [
	"satisfied",
	"continued",
	"resume_failed",
];
const ATTENTION_OPERATOR_STATUSES = new Set(["waiting_for_approval", "needs_input", "errored"]);
const APPROVAL_RESOLUTION_STATUSES = new Set<ActionInvocationStatus>([
	"approved",
	"denied",
	"expired",
]);

function isDuplicateActiveResumeIntentError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.includes("uq_resume_intents_one_active") ||
			error.message.includes("duplicate key value"))
	);
}

// ============================================
// Queries
// ============================================

export interface CreateInvocationInput {
	sessionId: string;
	organizationId: string;
	integrationId: string | null;
	integration: string;
	action: string;
	riskLevel: "read" | "write" | "danger";
	params: unknown;
	status: ActionInvocationStatus;
	mode?: string;
	modeSource?: string;
	deniedReason?: string;
	expiresAt?: Date;
}

export async function createInvocation(input: CreateInvocationInput): Promise<ActionInvocationRow> {
	const db = getDb();
	const [row] = await db
		.insert(actionInvocations)
		.values({
			sessionId: input.sessionId,
			organizationId: input.organizationId,
			integrationId: input.integrationId,
			integration: input.integration,
			action: input.action,
			riskLevel: input.riskLevel,
			mode: input.mode,
			modeSource: input.modeSource,
			params: input.params,
			status: input.status,
			deniedReason: input.deniedReason,
			expiresAt: input.expiresAt,
		})
		.returning();
	return row;
}

export async function getInvocation(
	id: string,
	organizationId: string,
): Promise<ActionInvocationRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(actionInvocations)
		.where(and(eq(actionInvocations.id, id), eq(actionInvocations.organizationId, organizationId)))
		.limit(1);
	return row;
}

export async function getInvocationById(id: string): Promise<ActionInvocationRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(actionInvocations)
		.where(eq(actionInvocations.id, id))
		.limit(1);
	return row;
}

export async function updateInvocationStatus(
	id: string,
	status: ActionInvocationStatus,
	data?: {
		result?: unknown;
		error?: string;
		approvedBy?: string;
		approvedAt?: Date;
		completedAt?: Date;
		durationMs?: number;
		deniedReason?: string;
		expiresAt?: Date | null;
	},
): Promise<ActionInvocationRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(actionInvocations)
		.set({
			status,
			...data,
		})
		.where(eq(actionInvocations.id, id))
		.returning();
	return row;
}

export async function transitionInvocationStatus(input: {
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
}): Promise<ActionInvocationRow | undefined> {
	if (input.fromStatuses.length === 0) {
		throw new Error("fromStatuses must include at least one status");
	}

	const db = getDb();
	const [row] = await db
		.update(actionInvocations)
		.set({
			status: input.toStatus,
			...input.data,
		})
		.where(
			and(
				eq(actionInvocations.id, input.id),
				inArray(actionInvocations.status, input.fromStatuses),
			),
		)
		.returning();
	return row;
}

export async function listBySession(sessionId: string): Promise<ActionInvocationRow[]> {
	const db = getDb();
	return db
		.select()
		.from(actionInvocations)
		.where(eq(actionInvocations.sessionId, sessionId))
		.orderBy(desc(actionInvocations.createdAt));
}

export async function listPendingBySession(sessionId: string): Promise<ActionInvocationRow[]> {
	const db = getDb();
	return db
		.select()
		.from(actionInvocations)
		.where(and(eq(actionInvocations.sessionId, sessionId), eq(actionInvocations.status, "pending")))
		.orderBy(desc(actionInvocations.createdAt));
}

export async function listExpirablePendingInvocations(now: Date): Promise<ActionInvocationRow[]> {
	const db = getDb();
	return db
		.select()
		.from(actionInvocations)
		.where(and(eq(actionInvocations.status, "pending"), lte(actionInvocations.expiresAt, now)));
}

export async function expirePendingInvocations(now: Date): Promise<number> {
	const db = getDb();
	const rows = await db
		.update(actionInvocations)
		.set({ status: "expired", completedAt: now })
		.where(and(eq(actionInvocations.status, "pending"), lte(actionInvocations.expiresAt, now)))
		.returning({ id: actionInvocations.id });
	return rows.length;
}

export async function getSessionApprovalContext(
	sessionId: string,
): Promise<SessionApprovalContext | undefined> {
	const db = getDb();
	const [row] = await db
		.select({
			id: sessions.id,
			organizationId: sessions.organizationId,
			automationId: sessions.automationId,
			operatorStatus: sessions.operatorStatus,
			visibility: sessions.visibility,
			createdBy: sessions.createdBy,
			repoId: sessions.repoId,
		})
		.from(sessions)
		.where(eq(sessions.id, sessionId))
		.limit(1);
	return row;
}

export async function getSessionAclRole(
	sessionId: string,
	userId: string,
): Promise<"viewer" | "editor" | "reviewer" | undefined> {
	const db = getDb();
	const [row] = await db
		.select({ role: sessionAcl.role })
		.from(sessionAcl)
		.where(and(eq(sessionAcl.sessionId, sessionId), eq(sessionAcl.userId, userId)))
		.limit(1);

	const role = row?.role;
	if (role === "viewer" || role === "editor" || role === "reviewer") {
		return role;
	}
	return undefined;
}

export async function setSessionOperatorStatus(input: {
	sessionId: string;
	toStatus: string;
	fromStatuses?: string[];
}): Promise<boolean> {
	const db = getDb();
	const shouldTouchVisibility = ATTENTION_OPERATOR_STATUSES.has(input.toStatus);
	const where = input.fromStatuses?.length
		? and(eq(sessions.id, input.sessionId), inArray(sessions.operatorStatus, input.fromStatuses))
		: eq(sessions.id, input.sessionId);

	const rows = await db
		.update(sessions)
		.set({
			operatorStatus: input.toStatus,
			...(shouldTouchVisibility && { lastVisibleUpdateAt: new Date() }),
		})
		.where(where)
		.returning({ id: sessions.id });

	return rows.length > 0;
}

export async function getSessionCapabilityMode(
	sessionId: string,
	capabilityKey: string,
): Promise<SessionCapabilityMode | undefined> {
	const db = getDb();
	const [row] = await db
		.select({ mode: sessionCapabilities.mode })
		.from(sessionCapabilities)
		.where(
			and(
				eq(sessionCapabilities.sessionId, sessionId),
				eq(sessionCapabilities.capabilityKey, capabilityKey),
			),
		)
		.limit(1);

	const mode = row?.mode;
	if (mode === "allow" || mode === "require_approval" || mode === "deny") {
		return mode;
	}
	return undefined;
}

export async function createActionInvocationEvent(input: {
	actionInvocationId: string;
	eventType: string;
	actorUserId?: string | null;
	payloadJson?: unknown;
}): Promise<ActionInvocationEventRow> {
	const db = getDb();
	const [row] = await db
		.insert(actionInvocationEvents)
		.values({
			actionInvocationId: input.actionInvocationId,
			eventType: input.eventType,
			actorUserId: input.actorUserId ?? null,
			payloadJson: input.payloadJson ?? null,
		})
		.returning();
	return row;
}

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

export async function transitionInvocationWithEffects(
	input: TransitionInvocationWithEffectsInput,
): Promise<TransitionInvocationWithEffectsResult> {
	if (input.fromStatuses.length === 0) {
		throw new Error("fromStatuses must include at least one status");
	}

	const db = getDb();
	return db.transaction(async (tx) => {
		const [invocation] = await tx
			.update(actionInvocations)
			.set({
				status: input.toStatus,
				...input.data,
			})
			.where(
				and(
					eq(actionInvocations.id, input.id),
					inArray(actionInvocations.status, input.fromStatuses),
				),
			)
			.returning();

		if (!invocation) {
			return { invocation: undefined, resumeIntent: undefined };
		}

		if (input.event) {
			await tx.insert(actionInvocationEvents).values({
				actionInvocationId: invocation.id,
				eventType: input.event.eventType,
				actorUserId: input.event.actorUserId ?? null,
				payloadJson: input.event.payloadJson ?? null,
			});
		}

		if (APPROVAL_RESOLUTION_STATUSES.has(input.toStatus)) {
			await tx
				.update(sessions)
				.set({ lastVisibleUpdateAt: new Date() })
				.where(eq(sessions.id, invocation.sessionId));
		}

		let resumeIntent: ResumeIntentRow | undefined;
		if (input.resumeIntent && invocation.mode === "require_approval") {
			const [session] = await tx
				.select({ operatorStatus: sessions.operatorStatus })
				.from(sessions)
				.where(eq(sessions.id, invocation.sessionId))
				.limit(1);

			if (session?.operatorStatus === "waiting_for_approval") {
				const [existing] = await tx
					.select()
					.from(resumeIntents)
					.where(
						and(
							eq(resumeIntents.originSessionId, invocation.sessionId),
							eq(resumeIntents.invocationId, invocation.id),
							notInArray(resumeIntents.status, TERMINAL_RESUME_INTENT_STATUSES),
						),
					)
					.limit(1);

				if (existing) {
					resumeIntent = existing;
				} else {
					try {
						const [created] = await tx
							.insert(resumeIntents)
							.values({
								originSessionId: invocation.sessionId,
								invocationId: invocation.id,
								status: "queued",
								payloadJson: input.resumeIntent.payloadJson ?? null,
							})
							.returning();
						resumeIntent = created;
					} catch (error) {
						if (!isDuplicateActiveResumeIntentError(error)) {
							throw error;
						}

						const [retried] = await tx
							.select()
							.from(resumeIntents)
							.where(
								and(
									eq(resumeIntents.originSessionId, invocation.sessionId),
									eq(resumeIntents.invocationId, invocation.id),
									notInArray(resumeIntents.status, TERMINAL_RESUME_INTENT_STATUSES),
								),
							)
							.limit(1);
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

export async function listActionInvocationEvents(
	actionInvocationId: string,
): Promise<ActionInvocationEventRow[]> {
	const db = getDb();
	return db
		.select()
		.from(actionInvocationEvents)
		.where(eq(actionInvocationEvents.actionInvocationId, actionInvocationId))
		.orderBy(desc(actionInvocationEvents.createdAt));
}

export async function getActiveResumeIntent(
	originSessionId: string,
	invocationId: string,
): Promise<ResumeIntentRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(resumeIntents)
		.where(
			and(
				eq(resumeIntents.originSessionId, originSessionId),
				eq(resumeIntents.invocationId, invocationId),
				notInArray(resumeIntents.status, TERMINAL_RESUME_INTENT_STATUSES),
			),
		)
		.limit(1);
	return row;
}

export async function createOrGetActiveResumeIntent(input: {
	originSessionId: string;
	invocationId: string;
	payloadJson?: unknown;
}): Promise<ResumeIntentRow> {
	const existing = await getActiveResumeIntent(input.originSessionId, input.invocationId);
	if (existing) {
		return existing;
	}

	const db = getDb();
	try {
		const [row] = await db
			.insert(resumeIntents)
			.values({
				originSessionId: input.originSessionId,
				invocationId: input.invocationId,
				status: "queued",
				payloadJson: input.payloadJson ?? null,
			})
			.returning();
		return row;
	} catch (error) {
		if (!isDuplicateActiveResumeIntentError(error)) {
			throw error;
		}
		const retry = await getActiveResumeIntent(input.originSessionId, input.invocationId);
		if (!retry) {
			throw error;
		}
		return retry;
	}
}

export async function transitionResumeIntentStatus(input: {
	id: string;
	fromStatuses: ResumeIntentStatus[];
	toStatus: ResumeIntentStatus;
	errorMessage?: string | null;
	resolvedAt?: Date | null;
	claimedAt?: Date | null;
}): Promise<ResumeIntentRow | undefined> {
	if (input.fromStatuses.length === 0) {
		throw new Error("fromStatuses must include at least one status");
	}

	const db = getDb();
	const [row] = await db
		.update(resumeIntents)
		.set({
			status: input.toStatus,
			errorMessage: input.errorMessage,
			resolvedAt: input.resolvedAt,
			claimedAt: input.claimedAt,
		})
		.where(and(eq(resumeIntents.id, input.id), inArray(resumeIntents.status, input.fromStatuses)))
		.returning();
	return row;
}

export async function listByOrg(
	organizationId: string,
	options?: {
		status?: string;
		limit?: number;
		offset?: number;
	},
): Promise<ActionInvocationWithSession[]> {
	const db = getDb();
	const conditions = [eq(actionInvocations.organizationId, organizationId)];
	if (options?.status) {
		conditions.push(eq(actionInvocations.status, options.status));
	}
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;
	const rows = await db
		.select({
			invocation: actionInvocations,
			sessionTitle: sessions.title,
		})
		.from(actionInvocations)
		.leftJoin(sessions, eq(actionInvocations.sessionId, sessions.id))
		.where(and(...conditions))
		.orderBy(desc(actionInvocations.createdAt))
		.limit(limit)
		.offset(offset);
	return rows.map((r) => ({ ...r.invocation, sessionTitle: r.sessionTitle }));
}

export async function countByOrg(organizationId: string, status?: string): Promise<number> {
	const db = getDb();
	const conditions = [eq(actionInvocations.organizationId, organizationId)];
	if (status) {
		conditions.push(eq(actionInvocations.status, status));
	}
	const [result] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(actionInvocations)
		.where(and(...conditions));
	return result.count;
}
