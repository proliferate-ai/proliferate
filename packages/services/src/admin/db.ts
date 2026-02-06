/**
 * Admin DB operations.
 *
 * Drizzle queries - no business logic.
 */

import { and, desc, eq, getDb, member, organization, user } from "../db/client";
import { toIsoString } from "../db/serialize";
import type {
	MembershipRow,
	OrganizationRow,
	OrganizationWithMembersRow,
	UserRow,
	UserWithMembershipsRow,
} from "../types/admin";

// ============================================
// User Queries
// ============================================

/**
 * List all users with their organization memberships.
 */
export async function listUsers(): Promise<UserWithMembershipsRow[]> {
	const db = getDb();
	const users = await db.query.user.findMany({
		columns: {
			id: true,
			email: true,
			name: true,
			createdAt: true,
		},
		with: {
			members: {
				columns: {
					organizationId: true,
					role: true,
				},
				with: {
					organization: {
						columns: {
							id: true,
							name: true,
						},
					},
				},
			},
		},
		orderBy: [desc(user.createdAt)],
	});

	// Transform to match expected type shape
	return users.map((u) => ({
		id: u.id,
		email: u.email,
		name: u.name,
		createdAt: toIsoString(u.createdAt) ?? "",
		member: u.members.map((m) => ({
			organizationId: m.organizationId,
			role: m.role,
			organization: m.organization ? { id: m.organization.id, name: m.organization.name } : null,
		})),
	}));
}

/**
 * Find a user by ID.
 */
export async function findUserById(userId: string): Promise<UserRow | null> {
	const db = getDb();
	const result = await db.query.user.findFirst({
		columns: {
			id: true,
			email: true,
			name: true,
			createdAt: true,
		},
		where: eq(user.id, userId),
	});

	if (!result) return null;

	return {
		id: result.id,
		email: result.email,
		name: result.name,
		createdAt: toIsoString(result.createdAt) ?? "",
	};
}

/**
 * Get user's organization memberships.
 */
export async function getUserMemberships(userId: string): Promise<MembershipRow[]> {
	const db = getDb();
	const memberships = await db.query.member.findMany({
		columns: {
			organizationId: true,
			role: true,
			userId: true,
		},
		with: {
			organization: {
				columns: {
					id: true,
					name: true,
				},
			},
		},
		where: eq(member.userId, userId),
	});

	return memberships.map((m) => ({
		userId: m.userId,
		organizationId: m.organizationId,
		role: m.role,
		organization: m.organization ? { id: m.organization.id, name: m.organization.name } : null,
	}));
}

// ============================================
// Organization Queries
// ============================================

/**
 * List all organizations with member counts.
 */
export async function listOrganizations(): Promise<OrganizationWithMembersRow[]> {
	const db = getDb();
	const orgs = await db.query.organization.findMany({
		columns: {
			id: true,
			name: true,
			slug: true,
			isPersonal: true,
			createdAt: true,
		},
		with: {
			members: {
				columns: {
					userId: true,
				},
			},
		},
		orderBy: [desc(organization.createdAt)],
	});

	return orgs.map((o) => ({
		id: o.id,
		name: o.name,
		slug: o.slug,
		is_personal: o.isPersonal,
		createdAt: toIsoString(o.createdAt) ?? "",
		member: o.members.map((m) => ({ userId: m.userId })),
	}));
}

/**
 * Find an organization by ID.
 */
export async function findOrganizationById(orgId: string): Promise<OrganizationRow | null> {
	const db = getDb();
	const result = await db.query.organization.findFirst({
		columns: {
			id: true,
			name: true,
			slug: true,
			isPersonal: true,
			createdAt: true,
		},
		where: eq(organization.id, orgId),
	});

	if (!result) return null;

	return {
		id: result.id,
		name: result.name,
		slug: result.slug,
		is_personal: result.isPersonal,
		createdAt: toIsoString(result.createdAt) ?? "",
	};
}

// ============================================
// Membership Queries
// ============================================

/**
 * Check if a user is a member of an organization.
 */
export async function checkMembership(userId: string, orgId: string): Promise<boolean> {
	const db = getDb();
	const result = await db.query.member.findFirst({
		columns: {
			userId: true,
		},
		where: and(eq(member.userId, userId), eq(member.organizationId, orgId)),
	});

	return !!result;
}
