/**
 * Actions DB operations.
 *
 * Raw Drizzle queries for action_invocations.
 */

import {
	type InferSelectModel,
	actionInvocations,
	and,
	desc,
	eq,
	getDb,
	lte,
	sessions,
	sql,
} from "../db/client";

// ============================================
// Type Exports
// ============================================

export type ActionInvocationRow = InferSelectModel<typeof actionInvocations>;

export type ActionInvocationWithSession = ActionInvocationRow & {
	sessionTitle: string | null;
};

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
	status: string;
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
	status: string,
	data?: {
		result?: unknown;
		error?: string;
		approvedBy?: string;
		approvedAt?: Date;
		completedAt?: Date;
		durationMs?: number;
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

export async function expirePendingInvocations(now: Date): Promise<number> {
	const db = getDb();
	const rows = await db
		.update(actionInvocations)
		.set({ status: "expired", completedAt: now })
		.where(and(eq(actionInvocations.status, "pending"), lte(actionInvocations.expiresAt, now)))
		.returning({ id: actionInvocations.id });
	return rows.length;
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
