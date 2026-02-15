/**
 * Dashboard-related types.
 * These are used across dashboard components for configurations, members, etc.
 */

/**
 * Secret stored in our database.
 */
export interface Secret {
	id: string;
	key: string;
	description: string | null;
	secretType: string | null;
	repoId: string | null;
	createdAt: string | null;
}

/**
 * Snapshot/Configuration from our database.
 * Note: In the database this is the "configurations" table.
 */
export interface Snapshot {
	id: string;
	name: string;
	description: string | null;
	createdAt: string;
	setupSessions?: Array<{ id: string; sessionType: string }>;
	repos?: Array<{ id: string; githubRepoName: string }>;
}

/**
 * Organization member with user info.
 * Used by org member listings which always join user data.
 */
export interface Member {
	id: string;
	userId: string;
	role: "owner" | "admin" | "member";
	createdAt: string;
	user: {
		id: string;
		name: string | null;
		email: string;
		image: string | null;
	};
}

/**
 * Pending organization invitation.
 */
export interface Invitation {
	id: string;
	email: string;
	role: "admin" | "member";
	status: "pending" | "accepted" | "rejected" | "canceled";
	expiresAt: string;
	inviterId: string;
}

/**
 * Integration/connection data.
 */
export interface Integration {
	id: string;
	provider: string;
	providerAccountId: string;
	status: string;
	scopes: string[] | null;
	createdAt: string;
	createdBy: string;
	metadata?: Record<string, unknown>;
}
