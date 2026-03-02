/**
 * Back-compat export shim for prior `sessions/v1-db` imports.
 *
 * V1 session persistence helpers now live in the canonical `sessions/db.ts`.
 * New K-phase helpers (lifecycle, ACL, archive) are defined below.
 */

export * from "./db";

import {
	and,
	asc,
	eq,
	getDb,
	sessionAcl,
	sessionEvents,
	sessions,
} from "@proliferate/services/db/client";

// ============================================
// K3: Session visible update
// ============================================

export async function updateLastVisibleUpdateAt(sessionId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ lastVisibleUpdateAt: new Date() })
		.where(eq(sessions.id, sessionId));
}

// ============================================
// K4: Operator status projection
// ============================================

export async function updateOperatorStatus(
	sessionId: string,
	operatorStatus: string,
): Promise<void> {
	const db = getDb();
	await db.update(sessions).set({ operatorStatus }).where(eq(sessions.id, sessionId));
}

// ============================================
// K5: Session events
// ============================================

export interface CreateSessionEventInput {
	sessionId: string;
	eventType: string;
	actorUserId?: string | null;
	payloadJson?: unknown;
}

export async function createSessionEvent(input: CreateSessionEventInput): Promise<void> {
	const db = getDb();
	await db.insert(sessionEvents).values({
		sessionId: input.sessionId,
		eventType: input.eventType,
		actorUserId: input.actorUserId ?? null,
		payloadJson: input.payloadJson ?? null,
	});
}

export async function listSessionEvents(sessionId: string): Promise<
	Array<{
		id: string;
		sessionId: string;
		eventType: string;
		actorUserId: string | null;
		payloadJson: unknown;
		createdAt: Date;
	}>
> {
	const db = getDb();
	return db
		.select()
		.from(sessionEvents)
		.where(eq(sessionEvents.sessionId, sessionId))
		.orderBy(asc(sessionEvents.createdAt));
}

// ============================================
// K2: Session ACL
// ============================================

export async function getSessionAclRole(sessionId: string, userId: string): Promise<string | null> {
	const db = getDb();
	const [row] = await db
		.select({ role: sessionAcl.role })
		.from(sessionAcl)
		.where(and(eq(sessionAcl.sessionId, sessionId), eq(sessionAcl.userId, userId)))
		.limit(1);
	return row?.role ?? null;
}

export async function grantSessionAcl(input: {
	sessionId: string;
	userId: string;
	role: string;
	grantedBy?: string | null;
}): Promise<void> {
	const db = getDb();
	await db
		.insert(sessionAcl)
		.values({
			sessionId: input.sessionId,
			userId: input.userId,
			role: input.role,
			grantedBy: input.grantedBy ?? null,
		})
		.onConflictDoUpdate({
			target: [sessionAcl.sessionId, sessionAcl.userId],
			set: { role: input.role, grantedBy: input.grantedBy ?? null },
		});
}

export async function updateSessionVisibility(
	sessionId: string,
	visibility: "private" | "shared" | "org",
): Promise<void> {
	const db = getDb();
	await db.update(sessions).set({ visibility }).where(eq(sessions.id, sessionId));
}

// ============================================
// K6: Archive and delete
// ============================================

export async function archiveSession(sessionId: string, userId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ archivedAt: new Date(), archivedBy: userId })
		.where(eq(sessions.id, sessionId));
}

export async function unarchiveSession(sessionId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ archivedAt: null, archivedBy: null })
		.where(eq(sessions.id, sessionId));
}

export async function softDeleteSession(sessionId: string, userId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ deletedAt: new Date(), deletedBy: userId })
		.where(eq(sessions.id, sessionId));
}

export async function archiveSessionForUser(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	const { upsertSessionUserState } = await import("./db");
	await upsertSessionUserState({
		sessionId: input.sessionId,
		userId: input.userId,
		archivedAt: new Date(),
	});
}

export async function unarchiveSessionForUser(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	const { upsertSessionUserState } = await import("./db");
	await upsertSessionUserState({
		sessionId: input.sessionId,
		userId: input.userId,
		archivedAt: null,
	});
}
