/**
 * Orgs service.
 *
 * Business logic that orchestrates DB operations.
 */

import type {
	Invitation,
	Member,
	OrgRole,
	Organization,
	OrganizationWithRole,
} from "@proliferate/shared";
import type { OrgBillingSettings } from "@proliferate/shared/billing";
import * as orgsDb from "./db";
import {
	toDomainSuggestions,
	toInvitations,
	toMember,
	toMembers,
	toOrganization,
	toOrganizationsWithRole,
} from "./mapper";

// ============================================
// Types
// ============================================

export interface MembersAndInvitations {
	members: Member[];
	invitations: Invitation[];
	currentUserRole: OrgRole;
}

export interface DomainSuggestions {
	suggestions: Array<{ id: string; name: string; slug: string; logo: string | null }>;
	domain?: string;
}

export interface UpdateMemberRoleResult {
	success: boolean;
	error?: string;
}

export interface RemoveMemberResult {
	success: boolean;
	error?: string;
}

// ============================================
// Service functions
// ============================================

/**
 * List all organizations the user belongs to.
 */
export async function listOrgs(userId: string): Promise<OrganizationWithRole[]> {
	const rows = await orgsDb.listByUser(userId);
	return toOrganizationsWithRole(rows);
}

/**
 * Get a single organization by ID.
 * Returns null if not found or user is not a member.
 */
export async function getOrg(orgId: string, userId: string): Promise<Organization | null> {
	// Check membership first
	const role = await orgsDb.getUserRole(userId, orgId);
	if (!role) return null;

	const row = await orgsDb.findById(orgId);
	if (!row) return null;

	return toOrganization(row);
}

/**
 * Get user's role in an organization.
 */
export async function getUserRole(userId: string, orgId: string): Promise<OrgRole | null> {
	const role = await orgsDb.getUserRole(userId, orgId);
	return role as OrgRole | null;
}

/**
 * Get organization IDs a user belongs to.
 */
export async function getUserOrgIds(userId: string): Promise<string[]> {
	return orgsDb.getUserOrgIds(userId);
}

/**
 * Get first organization ID for a user (if any).
 */
export async function getFirstOrgIdForUser(userId: string): Promise<string | null> {
	const orgIds = await orgsDb.getUserOrgIds(userId);
	return orgIds[0] ?? null;
}

/**
 * Get billing-related organization fields.
 */
export async function getBillingInfo(orgId: string): Promise<{
	id: string;
	name: string;
	billingSettings: OrgBillingSettings | null;
	autumnCustomerId: string | null;
	onboardingComplete: boolean | null;
	billingPlan: string | null;
} | null> {
	return orgsDb.findBillingInfo(orgId);
}

/**
 * Get billing-related organization fields (V2 with shadow balance).
 */
export async function getBillingInfoV2(orgId: string): Promise<{
	id: string;
	name: string;
	billingSettings: OrgBillingSettings | null;
	autumnCustomerId: string | null;
	onboardingComplete: boolean | null;
	billingPlan: string | null;
	billingState: string;
	shadowBalance: string | null;
	shadowBalanceUpdatedAt: Date | null;
	graceEnteredAt: Date | null;
	graceExpiresAt: Date | null;
} | null> {
	return orgsDb.findBillingInfoV2(orgId);
}

/**
 * Update billing settings for an organization.
 */
export async function updateBillingSettings(
	orgId: string,
	settings: OrgBillingSettings,
): Promise<void> {
	await orgsDb.updateBillingSettings(orgId, settings);
}

/**
 * Update billing plan selection for an organization.
 */
export async function updateBillingPlan(orgId: string, plan: string): Promise<void> {
	await orgsDb.updateBillingPlan(orgId, plan);
}

/**
 * Update Autumn customer ID for an organization.
 */
export async function updateAutumnCustomerId(orgId: string, customerId: string): Promise<void> {
	await orgsDb.updateAutumnCustomerId(orgId, customerId);
}

/**
 * Initialize billing state + shadow balance for an organization.
 */
export async function initializeBillingState(
	orgId: string,
	state: string,
	shadowBalance: number,
): Promise<void> {
	await orgsDb.initializeBillingState(orgId, state, shadowBalance);
}

/**
 * List orgs with expired grace periods.
 */
export async function listGraceExpiredOrgs(): Promise<{ id: string }[]> {
	return orgsDb.listGraceExpiredOrgs();
}

/**
 * Mark an org's grace period as expired (exhausted).
 */
export async function expireGraceForOrg(orgId: string): Promise<void> {
	await orgsDb.expireGraceForOrg(orgId);
}

/**
 * Mark onboarding complete for an organization.
 */
export async function markOnboardingComplete(
	orgId: string,
	onboardingComplete = true,
): Promise<void> {
	await orgsDb.markOnboardingComplete(orgId, onboardingComplete);
}

/**
 * List all members of an organization.
 * Returns null if user is not a member.
 */
export async function listMembers(orgId: string, userId: string): Promise<Member[] | null> {
	// Check membership first
	const role = await orgsDb.getUserRole(userId, orgId);
	if (!role) return null;

	const rows = await orgsDb.listMembers(orgId);
	return toMembers(rows);
}

/**
 * List pending invitations for an organization.
 * Returns null if user is not a member.
 */
export async function listInvitations(orgId: string, userId: string): Promise<Invitation[] | null> {
	// Check membership first
	const role = await orgsDb.getUserRole(userId, orgId);
	if (!role) return null;

	const rows = await orgsDb.listInvitations(orgId);
	return toInvitations(rows);
}

/**
 * Get members and invitations in one request.
 * Optimized for the team settings page.
 */
export async function getMembersAndInvitations(
	orgId: string,
	userId: string,
): Promise<MembersAndInvitations | null> {
	// Run membership check, members, and invitations in parallel
	const [role, memberRows, invitationRows] = await Promise.all([
		orgsDb.getUserRole(userId, orgId),
		orgsDb.listMembers(orgId),
		orgsDb.listInvitations(orgId),
	]);

	// Check membership
	if (!role) return null;

	return {
		members: toMembers(memberRows),
		invitations: toInvitations(invitationRows),
		currentUserRole: role as OrgRole,
	};
}

/**
 * Update allowed domains for auto-join.
 * Only owners can perform this action.
 */
export async function updateDomains(
	orgId: string,
	userId: string,
	domains: string[],
): Promise<{ allowed_domains: string[] } | { error: string }> {
	// Check if user is owner
	const role = await orgsDb.getUserRole(userId, orgId);
	if (role !== "owner") {
		return { error: "Only owners can manage domains" };
	}

	// Validate and normalize domains
	const validDomains = domains
		.map((d) => d.toLowerCase().trim())
		.filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));

	await orgsDb.updateAllowedDomains(orgId, validDomains);
	return { allowed_domains: validDomains };
}

/**
 * Update a member's role.
 * Only owners can perform this action.
 */
export async function updateMemberRole(
	orgId: string,
	memberId: string,
	userId: string,
	newRole: "admin" | "member",
): Promise<UpdateMemberRoleResult> {
	// Check if user is owner
	const userRole = await orgsDb.getUserRole(userId, orgId);
	if (userRole !== "owner") {
		return { success: false, error: "Only owners can change roles" };
	}

	// Get the member to check their current role
	const member = await orgsDb.findMemberById(memberId, orgId);
	if (!member) {
		return { success: false, error: "Member not found" };
	}

	// Don't allow changing owner role
	if (member.role === "owner") {
		return { success: false, error: "Cannot change owner role" };
	}

	await orgsDb.updateMemberRole(memberId, orgId, newRole);
	return { success: true };
}

/**
 * Remove a member from the organization.
 * Only owners can perform this action.
 */
export async function removeMember(
	orgId: string,
	memberId: string,
	userId: string,
): Promise<RemoveMemberResult> {
	// Check if user is owner
	const userRole = await orgsDb.getUserRole(userId, orgId);
	if (userRole !== "owner") {
		return { success: false, error: "Only owners can remove members" };
	}

	// Get the member to check their role and identity
	const member = await orgsDb.findMemberById(memberId, orgId);
	if (!member) {
		return { success: false, error: "Member not found" };
	}

	// Don't allow removing owner
	if (member.role === "owner") {
		return { success: false, error: "Cannot remove owner" };
	}

	// Don't allow removing yourself through this endpoint
	if (member.userId === userId) {
		return { success: false, error: "Cannot remove yourself" };
	}

	await orgsDb.removeMember(memberId, orgId);
	return { success: true };
}

/**
 * Get organizations matching user's email domain for auto-join.
 */
export async function getDomainSuggestions(
	userId: string,
	userEmail: string,
): Promise<DomainSuggestions> {
	// Extract domain from email
	const domain = userEmail.split("@")[1]?.toLowerCase();
	if (!domain) {
		return { suggestions: [] };
	}

	// Find organizations with matching domain
	const orgs = await orgsDb.findByAllowedDomain(domain);
	if (orgs.length === 0) {
		return { suggestions: [], domain };
	}

	// Filter out orgs the user is already a member of
	const memberOrgIds = await orgsDb.getUserOrgIds(userId);
	const memberOrgIdSet = new Set(memberOrgIds);
	const filteredOrgs = orgs.filter((org) => !memberOrgIdSet.has(org.id));

	return {
		suggestions: toDomainSuggestions(filteredOrgs),
		domain,
	};
}

// ============================================
// Action Modes
// ============================================

export type { ActionMode, ActionModesMap } from "./db";

/**
 * Get action_modes for an organization.
 */
export async function getActionModes(orgId: string): Promise<orgsDb.ActionModesMap> {
	return orgsDb.getActionModes(orgId);
}

/**
 * Set a single action mode for an organization.
 * Requires admin or owner role.
 */
export async function setActionMode(
	orgId: string,
	userId: string,
	key: string,
	mode: orgsDb.ActionMode,
): Promise<void> {
	const role = await orgsDb.getUserRole(userId, orgId);
	if (role !== "owner" && role !== "admin") {
		throw new Error("Only admins and owners can manage action modes");
	}
	await orgsDb.setActionMode(orgId, key, mode);
}

/**
 * Check if a user is a member of an organization.
 */
export async function isMember(userId: string, orgId: string): Promise<boolean> {
	const role = await orgsDb.getUserRole(userId, orgId);
	return role !== null;
}

/**
 * Get a member by ID.
 */
export async function getMember(memberId: string, orgId: string): Promise<Member | null> {
	const row = await orgsDb.findMemberById(memberId, orgId);
	if (!row) return null;
	return toMember(row);
}
