/**
 * Sessions service.
 *
 * Business logic that orchestrates DB operations.
 * Note: Complex operations like create, pause, resume remain in the API routes
 * due to their dependencies on auth, crypto, sandbox providers, etc.
 */

import type { Session } from "@proliferate/shared";
import type { ListSessionsOptions, SessionStatus, UpdateSessionInput } from "../types/sessions";
import type { SessionRow } from "./db";
import * as sessionsDb from "./db";
import { toSession, toSessions } from "./mapper";

// ============================================
// Service functions
// ============================================

/**
 * List all sessions for an organization.
 */
export async function listSessions(
	orgId: string,
	options?: ListSessionsOptions,
): Promise<Session[]> {
	const rows = await sessionsDb.listByOrganization(orgId, {
		repoId: options?.repoId,
		status: options?.status,
		limit: options?.limit,
		excludeSetup: options?.excludeSetup,
		excludeCli: options?.excludeCli,
		excludeAutomation: options?.excludeAutomation,
	});
	return toSessions(rows);
}

/**
 * Get a single session by ID.
 */
export async function getSession(id: string, orgId: string): Promise<Session | null> {
	const row = await sessionsDb.findById(id, orgId);
	if (!row) return null;
	return toSession(row);
}

/**
 * Get session status (no org check - used for public status endpoint).
 */
export async function getSessionStatus(id: string): Promise<SessionStatus | null> {
	const row = await sessionsDb.findByIdNoOrg(id);
	if (!row) return null;

	const status = row.status ?? "unknown";
	return {
		status,
		isComplete: status === "stopped",
	};
}

/**
 * Rename a session.
 */
export async function renameSession(
	id: string,
	orgId: string,
	title: string,
): Promise<Session | null> {
	// First verify it exists
	const session = await sessionsDb.findById(id, orgId);
	if (!session) return null;

	// Update the title
	await sessionsDb.updateWithOrgCheck(id, orgId, { title });

	// Return updated session
	return toSession({ ...session, title });
}

/**
 * Delete a session.
 */
export async function deleteSession(id: string, orgId: string): Promise<boolean> {
	await sessionsDb.deleteById(id, orgId);
	return true;
}

/**
 * Check if a session exists and belongs to the organization.
 */
export async function sessionExists(id: string, orgId: string): Promise<boolean> {
	const session = await sessionsDb.findById(id, orgId);
	return session !== null;
}

/**
 * Get full session data for internal operations (pause/resume).
 * Returns the raw DB row for use with sandbox providers.
 */
export async function getFullSession(id: string, orgId: string): Promise<SessionRow | null> {
	return sessionsDb.findFullById(id, orgId);
}

/**
 * Update session status and sandbox info.
 */
export async function updateSession(id: string, updates: UpdateSessionInput): Promise<void> {
	await sessionsDb.update(id, updates);
}

/**
 * Update session with org check.
 */
export async function updateSessionWithOrgCheck(
	id: string,
	orgId: string,
	updates: UpdateSessionInput,
): Promise<void> {
	await sessionsDb.updateWithOrgCheck(id, orgId, updates);
}

/**
 * Count running sessions for an organization.
 */
export async function countRunningByOrganization(orgId: string): Promise<number> {
	return sessionsDb.countRunningByOrganization(orgId);
}

/**
 * Get session counts by status for an organization.
 */
export async function getSessionCountsByOrganization(
	orgId: string,
): Promise<{ running: number; paused: number }> {
	return sessionsDb.getSessionCountsByOrganization(orgId);
}
