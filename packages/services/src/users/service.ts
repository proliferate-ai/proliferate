/**
 * Users service.
 *
 * Service-layer wrapper over users DB operations.
 */

import type { UserRow } from "./db";
import * as usersDb from "./db";

/**
 * Get a single user by ID.
 */
export async function findById(userId: string): Promise<UserRow | null> {
	return usersDb.findById(userId);
}
