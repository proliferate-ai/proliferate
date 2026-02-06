/**
 * Admin service.
 *
 * Business logic for super-admin operations.
 * Note: Super-admin checks and cookie management are handled at the router level.
 */

import * as adminDb from "./db";
import {
	type AdminOrganization,
	type AdminUser,
	type ImpersonatingOrg,
	type ImpersonatingUser,
	type ImpersonationInfo,
	type UserOrg,
	toAdminOrganizations,
	toAdminUsers,
	toImpersonatingUser,
	toUserOrgs,
} from "./mapper";

// ============================================
// Types
// ============================================

export interface ImpersonationData {
	userId: string;
	orgId: string;
}

export interface AdminStatusResult {
	isSuperAdmin: boolean;
	impersonating?: ImpersonationInfo | null;
}

export interface ImpersonateResult {
	user: ImpersonatingUser;
	org: ImpersonatingOrg;
}

// ============================================
// Service Functions
// ============================================

/**
 * Get admin status with optional impersonation info.
 * If impersonation data is provided, fetches the impersonated user/org details.
 */
export async function getAdminStatus(
	isSuperAdmin: boolean,
	impersonationData?: ImpersonationData | null,
): Promise<AdminStatusResult> {
	if (!isSuperAdmin) {
		return { isSuperAdmin: false };
	}

	if (!impersonationData) {
		return { isSuperAdmin: true, impersonating: null };
	}

	// Fetch impersonation details
	const [user, org, memberships] = await Promise.all([
		adminDb.findUserById(impersonationData.userId),
		adminDb.findOrganizationById(impersonationData.orgId),
		adminDb.getUserMemberships(impersonationData.userId),
	]);

	if (!user || !org) {
		// Impersonation data is stale
		return { isSuperAdmin: true, impersonating: null };
	}

	const userOrgs = toUserOrgs(memberships);

	return {
		isSuperAdmin: true,
		impersonating: {
			user: toImpersonatingUser(user),
			org: { id: org.id, name: org.name },
			userOrgs,
		},
	};
}

/**
 * List all users with their organization memberships.
 */
export async function listUsers(): Promise<AdminUser[]> {
	const rows = await adminDb.listUsers();
	return toAdminUsers(rows);
}

/**
 * List all organizations with member counts.
 */
export async function listOrganizations(): Promise<AdminOrganization[]> {
	const rows = await adminDb.listOrganizations();
	return toAdminOrganizations(rows);
}

/**
 * Validate and start impersonating a user in an organization.
 * Returns the user and org details on success.
 * Throws an error if user/org not found or user is not a member.
 */
export async function impersonate(userId: string, orgId: string): Promise<ImpersonateResult> {
	// Verify user exists
	const user = await adminDb.findUserById(userId);
	if (!user) {
		throw new ImpersonationError("User not found", "USER_NOT_FOUND");
	}

	// Verify org exists
	const org = await adminDb.findOrganizationById(orgId);
	if (!org) {
		throw new ImpersonationError("Organization not found", "ORG_NOT_FOUND");
	}

	// Verify user is a member of the org
	const isMember = await adminDb.checkMembership(userId, orgId);
	if (!isMember) {
		throw new ImpersonationError("User is not a member of this organization", "NOT_A_MEMBER");
	}

	return {
		user: toImpersonatingUser(user),
		org: { id: org.id, name: org.name },
	};
}

/**
 * Validate switching to a different org while impersonating.
 * Throws an error if the impersonated user is not a member of the org.
 */
export async function validateOrgSwitch(
	impersonatedUserId: string,
	newOrgId: string,
): Promise<void> {
	const isMember = await adminDb.checkMembership(impersonatedUserId, newOrgId);
	if (!isMember) {
		throw new ImpersonationError("User is not a member of this organization", "NOT_A_MEMBER");
	}
}

/**
 * Get user organizations for an impersonated user.
 */
export async function getImpersonatedUserOrgs(userId: string): Promise<UserOrg[]> {
	const memberships = await adminDb.getUserMemberships(userId);
	return toUserOrgs(memberships);
}

// ============================================
// Errors
// ============================================

export type ImpersonationErrorCode = "USER_NOT_FOUND" | "ORG_NOT_FOUND" | "NOT_A_MEMBER";

export class ImpersonationError extends Error {
	constructor(
		message: string,
		public readonly code: ImpersonationErrorCode,
	) {
		super(message);
		this.name = "ImpersonationError";
	}
}
