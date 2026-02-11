/**
 * Action grants DB operations.
 *
 * Raw Drizzle queries for action_grants.
 */

import {
	type InferSelectModel,
	actionGrants,
	and,
	desc,
	eq,
	getDb,
	gt,
	isNull,
	lt,
	or,
	sql,
} from "../db/client";

// ============================================
// Type Exports
// ============================================

export type ActionGrantRow = InferSelectModel<typeof actionGrants>;

// ============================================
// Queries
// ============================================

export interface CreateGrantInput {
	organizationId: string;
	createdBy: string;
	sessionId?: string | null;
	integration: string;
	action: string;
	maxCalls?: number | null;
	expiresAt?: Date | null;
}

export async function createGrant(input: CreateGrantInput): Promise<ActionGrantRow> {
	const db = getDb();
	const [row] = await db
		.insert(actionGrants)
		.values({
			organizationId: input.organizationId,
			createdBy: input.createdBy,
			sessionId: input.sessionId ?? null,
			integration: input.integration,
			action: input.action,
			maxCalls: input.maxCalls ?? null,
			expiresAt: input.expiresAt ?? null,
		})
		.returning();
	return row;
}

export async function getGrant(
	id: string,
	organizationId: string,
): Promise<ActionGrantRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(actionGrants)
		.where(and(eq(actionGrants.id, id), eq(actionGrants.organizationId, organizationId)))
		.limit(1);
	return row;
}

/**
 * List active (non-revoked, non-expired, non-exhausted) grants for an org.
 */
export async function listActiveGrants(
	organizationId: string,
	sessionId?: string,
): Promise<ActionGrantRow[]> {
	const db = getDb();
	const now = new Date();
	const conditions = [
		eq(actionGrants.organizationId, organizationId),
		isNull(actionGrants.revokedAt),
		or(isNull(actionGrants.expiresAt), gt(actionGrants.expiresAt, now)),
		or(isNull(actionGrants.maxCalls), lt(actionGrants.usedCalls, actionGrants.maxCalls)),
	];
	if (sessionId) {
		conditions.push(or(isNull(actionGrants.sessionId), eq(actionGrants.sessionId, sessionId)));
	}
	return db
		.select()
		.from(actionGrants)
		.where(and(...conditions))
		.orderBy(desc(actionGrants.createdAt));
}

/**
 * Find matching grants for a specific action invocation.
 * Returns grants that match the integration/action (exact or wildcard "*").
 */
export async function findMatchingGrants(
	organizationId: string,
	integration: string,
	action: string,
	sessionId?: string,
): Promise<ActionGrantRow[]> {
	const db = getDb();
	const now = new Date();
	const conditions = [
		eq(actionGrants.organizationId, organizationId),
		isNull(actionGrants.revokedAt),
		or(isNull(actionGrants.expiresAt), gt(actionGrants.expiresAt, now)),
		or(isNull(actionGrants.maxCalls), lt(actionGrants.usedCalls, actionGrants.maxCalls)),
		// Match integration: exact or wildcard
		or(eq(actionGrants.integration, integration), eq(actionGrants.integration, "*")),
		// Match action: exact or wildcard
		or(eq(actionGrants.action, action), eq(actionGrants.action, "*")),
	];
	if (sessionId) {
		// Grant must either be org-wide (null session) or scoped to this session
		conditions.push(or(isNull(actionGrants.sessionId), eq(actionGrants.sessionId, sessionId)));
	}
	return db
		.select()
		.from(actionGrants)
		.where(and(...conditions))
		.orderBy(desc(actionGrants.createdAt));
}

/**
 * Atomically consume one call from a grant's budget.
 * Uses a CAS-style update: only increments if the grant is still active
 * and not exhausted. Returns the updated row if successful, undefined otherwise.
 */
export async function consumeGrantCall(grantId: string): Promise<ActionGrantRow | undefined> {
	const db = getDb();
	const now = new Date();
	const [row] = await db
		.update(actionGrants)
		.set({
			usedCalls: sql`${actionGrants.usedCalls} + 1`,
		})
		.where(
			and(
				eq(actionGrants.id, grantId),
				isNull(actionGrants.revokedAt),
				or(isNull(actionGrants.expiresAt), gt(actionGrants.expiresAt, now)),
				or(isNull(actionGrants.maxCalls), lt(actionGrants.usedCalls, actionGrants.maxCalls)),
			),
		)
		.returning();
	return row;
}

/**
 * Revoke a grant by setting revokedAt.
 */
export async function revokeGrant(
	id: string,
	organizationId: string,
): Promise<ActionGrantRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(actionGrants)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(actionGrants.id, id),
				eq(actionGrants.organizationId, organizationId),
				isNull(actionGrants.revokedAt),
			),
		)
		.returning();
	return row;
}

/**
 * List all grants for an org (including inactive ones).
 */
export async function listGrantsByOrg(organizationId: string): Promise<ActionGrantRow[]> {
	const db = getDb();
	return db
		.select()
		.from(actionGrants)
		.where(eq(actionGrants.organizationId, organizationId))
		.orderBy(desc(actionGrants.createdAt));
}
