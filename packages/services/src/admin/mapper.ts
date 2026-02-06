/**
 * Admin mapper.
 *
 * Transforms DB rows to API response types.
 */

import type {
	MembershipRow,
	OrganizationWithMembersRow,
	UserRow,
	UserWithMembershipsRow,
} from "../types/admin";

// ============================================
// API Response Types
// ============================================

export interface AdminUser {
	id: string;
	email: string;
	name: string | null;
	createdAt: string;
	member?: Array<{
		organizationId: string;
		role: string;
		organization: {
			id: string;
			name: string;
		} | null;
	}>;
}

export interface AdminOrganization {
	id: string;
	name: string;
	slug: string;
	isPersonal: boolean | null;
	createdAt: string;
	memberCount: number;
}

export interface ImpersonatingUser {
	id: string;
	email: string;
	name: string | null;
}

export interface ImpersonatingOrg {
	id: string;
	name: string;
}

export interface UserOrg {
	id: string;
	name: string;
	role: string;
}

export interface ImpersonationInfo {
	user: ImpersonatingUser;
	org: ImpersonatingOrg;
	userOrgs?: UserOrg[];
}

// ============================================
// Mappers
// ============================================

/**
 * Map a user row to API type.
 */
export function toAdminUser(row: UserWithMembershipsRow): AdminUser {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		createdAt: row.createdAt,
		member: row.member,
	};
}

/**
 * Map multiple user rows to API types.
 */
export function toAdminUsers(rows: UserWithMembershipsRow[]): AdminUser[] {
	return rows.map(toAdminUser);
}

/**
 * Map an organization row to API type.
 */
export function toAdminOrganization(row: OrganizationWithMembersRow): AdminOrganization {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		isPersonal: row.is_personal,
		createdAt: row.createdAt,
		memberCount: row.member?.length || 0,
	};
}

/**
 * Map multiple organization rows to API types.
 */
export function toAdminOrganizations(rows: OrganizationWithMembersRow[]): AdminOrganization[] {
	return rows.map(toAdminOrganization);
}

/**
 * Map user row to impersonating user type.
 */
export function toImpersonatingUser(row: UserRow): ImpersonatingUser {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
	};
}

/**
 * Map memberships to user orgs.
 */
export function toUserOrgs(memberships: MembershipRow[]): UserOrg[] {
	return memberships
		.filter((m) => m.organization)
		.map((m) => ({
			id: m.organization!.id,
			name: m.organization!.name,
			role: m.role,
		}));
}
