/**
 * Users service.
 *
 * Service-layer wrapper over users DB operations.
 */

import type { GitHubAccountRow, UserRow } from "./db";
import * as usersDb from "./db";

/**
 * Get a single user by ID.
 */
export async function findById(userId: string): Promise<UserRow | null> {
	return usersDb.findById(userId);
}

/**
 * Get the user's linked GitHub OAuth account (from better-auth).
 */
export async function getGitHubAccount(userId: string): Promise<GitHubAccountRow | null> {
	return usersDb.findGitHubAccount(userId);
}

/**
 * Set git identity override (name/email used for commits).
 */
export async function setGitIdentity(
	userId: string,
	gitName: string | null,
	gitEmail: string | null,
): Promise<void> {
	return usersDb.updateGitIdentity(userId, gitName, gitEmail);
}

/**
 * Clear git identity override (revert to user.name/email).
 */
export async function clearGitIdentity(userId: string): Promise<void> {
	return usersDb.clearGitIdentity(userId);
}
