/**
 * Users DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import { type InferSelectModel, account, and, eq, getDb, user } from "../db/client";

// ============================================
// Types
// ============================================

/** User row type from Drizzle schema */
export type UserRow = InferSelectModel<typeof user>;

/** Subset of account row for GitHub OAuth */
export interface GitHubAccountRow {
	accountId: string;
	accessToken: string | null;
	scope: string | null;
}

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

/**
 * Find the user's linked GitHub OAuth account (from better-auth).
 */
export async function findGitHubAccount(userId: string): Promise<GitHubAccountRow | null> {
	const db = getDb();
	const result = await db.query.account.findFirst({
		where: and(eq(account.userId, userId), eq(account.providerId, "github")),
		columns: {
			accountId: true,
			accessToken: true,
			scope: true,
		},
	});
	return result ?? null;
}

/**
 * Set git identity override on user.
 */
export async function updateGitIdentity(
	userId: string,
	gitName: string | null,
	gitEmail: string | null,
): Promise<void> {
	const db = getDb();
	await db.update(user).set({ gitName, gitEmail }).where(eq(user.id, userId));
}

/**
 * Clear git identity override (revert to user.name/email).
 */
export async function clearGitIdentity(userId: string): Promise<void> {
	const db = getDb();
	await db.update(user).set({ gitName: null, gitEmail: null }).where(eq(user.id, userId));
}
