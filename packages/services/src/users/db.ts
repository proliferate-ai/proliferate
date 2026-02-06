/**
 * Users DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import { type InferSelectModel, eq, getDb, user } from "../db/client";

// ============================================
// Types
// ============================================

/** User row type from Drizzle schema */
export type UserRow = InferSelectModel<typeof user>;

// ============================================
// Queries
// ============================================

/**
 * Get a single user by ID.
 */
export async function findById(userId: string): Promise<UserRow | null> {
	const db = getDb();
	const result = await db.query.user.findFirst({
		where: eq(user.id, userId),
	});

	return result ?? null;
}
