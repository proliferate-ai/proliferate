/**
 * Orgs DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import type { OrgBillingSettings, OrgOverageState } from "@proliferate/shared/billing";
import {
	type InferSelectModel,
	and,
	eq,
	getDb,
	gt,
	inArray,
	invitation,
	isNull,
	lt,
	member,
	or,
	organization,
	sessions,
	sql,
	type user,
} from "../db/client";

// ============================================
// Types
// ============================================

/** Organization row type from Drizzle schema */
export type OrganizationRow = InferSelectModel<typeof organization>;

/** Parse billingSettings from text column (stored as JSON string). */
function parseBillingSettings(raw: unknown): OrgBillingSettings | null {
	if (!raw) return null;
	if (typeof raw === "object") return raw as OrgBillingSettings;
	if (typeof raw !== "string") return null;
	try {
		return JSON.parse(raw) as OrgBillingSettings;
	} catch {
		return null;
	}
}

/** Member row type from Drizzle schema */
export type MemberDbRow = InferSelectModel<typeof member>;

/** User row type from Drizzle schema */
export type UserRow = InferSelectModel<typeof user>;

/** Invitation row type from Drizzle schema */
export type InvitationDbRow = InferSelectModel<typeof invitation>;

/** Membership with organization relation */
export type MembershipRow = {
	organizationId: string;
	role: string;
	organization: OrganizationRow;
};

/** Member with user relation */
export type MemberRow = MemberDbRow & {
	user: Pick<UserRow, "id" | "name" | "email" | "image"> | null;
};

/** Invitation with inviter relation */
export type InvitationRow = InvitationDbRow & {
	inviter: Pick<UserRow, "name" | "email"> | null;
};

/** Domain suggestion row (subset of organization) */
export type DomainSuggestionRow = Pick<OrganizationRow, "id" | "name" | "slug" | "logo">;

// ============================================
// Queries
// ============================================

/**
 * List all organizations a user belongs to with their role.
 */
export async function listByUser(userId: string): Promise<MembershipRow[]> {
	const db = getDb();
	const results = await db.query.member.findMany({
		where: eq(member.userId, userId),
		with: {
			organization: true,
		},
	});

	return results.map((m) => ({
		organizationId: m.organizationId,
		role: m.role,
		organization: m.organization,
	}));
}

/**
 * Get a single organization by ID.
 */
export async function findById(orgId: string): Promise<OrganizationRow | null> {
	const db = getDb();
	const result = await db.query.organization.findFirst({
		where: eq(organization.id, orgId),
	});

	return result ?? null;
}

/**
 * Get user's role in an organization.
 */
export async function getUserRole(userId: string, orgId: string): Promise<string | null> {
	const db = getDb();
	const result = await db.query.member.findFirst({
		where: and(eq(member.userId, userId), eq(member.organizationId, orgId)),
		columns: {
			role: true,
		},
	});

	return result?.role ?? null;
}

/**
 * List all members of an organization.
 */
export async function listMembers(orgId: string): Promise<MemberRow[]> {
	const db = getDb();
	const results = await db.query.member.findMany({
		where: eq(member.organizationId, orgId),
		with: {
			user: {
				columns: {
					id: true,
					name: true,
					email: true,
					image: true,
				},
			},
		},
	});

	return results;
}

/**
 * Get a single member by ID.
 */
export async function findMemberById(memberId: string, orgId: string): Promise<MemberRow | null> {
	const db = getDb();
	const result = await db.query.member.findFirst({
		where: and(eq(member.id, memberId), eq(member.organizationId, orgId)),
		with: {
			user: {
				columns: {
					id: true,
					name: true,
					email: true,
					image: true,
				},
			},
		},
	});

	return result ?? null;
}

/**
 * List pending invitations for an organization.
 */
export async function listInvitations(orgId: string): Promise<InvitationRow[]> {
	const db = getDb();
	const results = await db.query.invitation.findMany({
		where: and(
			eq(invitation.organizationId, orgId),
			eq(invitation.status, "pending"),
			gt(invitation.expiresAt, new Date()),
		),
		with: {
			user: {
				columns: {
					name: true,
					email: true,
				},
			},
		},
	});

	return results.map((row) => {
		const { user: inviter, ...rest } = row;
		return { ...rest, inviter: inviter ?? null };
	});
}

/**
 * Update allowed domains for an organization.
 */
export async function updateAllowedDomains(orgId: string, domains: string[]): Promise<void> {
	const db = getDb();
	await db.update(organization).set({ allowedDomains: domains }).where(eq(organization.id, orgId));
}

/**
 * Update a member's role.
 */
export async function updateMemberRole(
	memberId: string,
	orgId: string,
	role: string,
): Promise<void> {
	const db = getDb();
	await db
		.update(member)
		.set({ role })
		.where(and(eq(member.id, memberId), eq(member.organizationId, orgId)));
}

/**
 * Remove a member from an organization.
 */
export async function removeMember(memberId: string, orgId: string): Promise<void> {
	const db = getDb();
	await db.delete(member).where(and(eq(member.id, memberId), eq(member.organizationId, orgId)));
}

/**
 * Find organizations with matching allowed_domains.
 */
export async function findByAllowedDomain(domain: string): Promise<DomainSuggestionRow[]> {
	const db = getDb();
	const results = await db.query.organization.findMany({
		where: sql`${organization.allowedDomains} @> ARRAY[${domain}]::text[]`,
		columns: {
			id: true,
			name: true,
			slug: true,
			logo: true,
		},
	});

	return results;
}

/**
 * Get organization IDs that a user is a member of.
 */
export async function getUserOrgIds(userId: string): Promise<string[]> {
	const db = getDb();
	const results = await db.query.member.findMany({
		where: eq(member.userId, userId),
		columns: {
			organizationId: true,
		},
	});

	return results.map((m) => m.organizationId);
}

// ============================================
// Public Invitation Lookup
// ============================================

/**
 * Fetch minimal invitation info by ID (no auth required).
 * Used to resolve the invited email before the user logs in.
 */
export async function findBasicInvitationInfo(invitationId: string): Promise<{
	email: string;
	status: string;
	expiresAt: Date;
	organizationName: string;
} | null> {
	const db = getDb();
	const result = await db.query.invitation.findFirst({
		where: eq(invitation.id, invitationId),
		columns: { email: true, status: true, expiresAt: true },
		with: {
			organization: { columns: { name: true } },
		},
	});
	if (!result) return null;
	return {
		email: result.email,
		status: result.status,
		expiresAt: result.expiresAt,
		organizationName: result.organization.name,
	};
}

/**
 * Delete a user's auto-created personal organization and its membership.
 * Only deletes orgs where is_personal = true and id matches the org_{userId} pattern.
 * Skips deletion if the org has any sessions (sessions FK lacks ON DELETE CASCADE).
 * The member + org deletion is wrapped in a transaction to prevent orphaned state.
 * Returns true if a personal org was found and deleted.
 */
export async function deletePersonalOrg(userId: string): Promise<boolean> {
	const db = getDb();
	const personalOrgId = `org_${userId}`;

	// Verify it exists and is actually a personal org
	const org = await db.query.organization.findFirst({
		where: and(eq(organization.id, personalOrgId), eq(organization.isPersonal, true)),
		columns: { id: true },
	});

	if (!org) return false;

	// Check for sessions — sessions FK has no cascade, so we can't delete if any exist
	const hasSession = await db.query.sessions.findFirst({
		where: eq(sessions.organizationId, personalOrgId),
		columns: { id: true },
	});

	if (hasSession) return false;

	// Delete member + org atomically to prevent orphaned state
	await db.transaction(async (tx) => {
		await tx
			.delete(member)
			.where(and(eq(member.organizationId, personalOrgId), eq(member.userId, userId)));
		await tx.delete(organization).where(eq(organization.id, personalOrgId));
	});

	return true;
}

// ============================================
// Billing / Onboarding Helpers
// ============================================

/**
 * Get billing-related organization fields.
 */
export async function findBillingInfo(orgId: string): Promise<{
	id: string;
	name: string;
	billingSettings: OrgBillingSettings | null;
	autumnCustomerId: string | null;
	onboardingComplete: boolean | null;
	billingPlan: string | null;
} | null> {
	const db = getDb();
	const result = await db.query.organization.findFirst({
		where: eq(organization.id, orgId),
		columns: {
			id: true,
			name: true,
			billingSettings: true,
			autumnCustomerId: true,
			onboardingComplete: true,
			billingPlan: true,
		},
	});

	if (!result) return null;

	return {
		id: result.id,
		name: result.name,
		billingSettings: parseBillingSettings(result.billingSettings),
		autumnCustomerId: result.autumnCustomerId ?? null,
		onboardingComplete: result.onboardingComplete ?? null,
		billingPlan: result.billingPlan ?? null,
	};
}

/**
 * Update billing settings for an organization.
 */
export async function updateBillingSettings(
	orgId: string,
	settings: OrgBillingSettings,
): Promise<void> {
	const db = getDb();
	await db
		.update(organization)
		.set({ billingSettings: JSON.stringify(settings) })
		.where(eq(organization.id, orgId));
}

/**
 * Update Autumn customer ID for an organization.
 */
export async function updateAutumnCustomerId(orgId: string, customerId: string): Promise<void> {
	const db = getDb();
	await db
		.update(organization)
		.set({ autumnCustomerId: customerId })
		.where(eq(organization.id, orgId));
}

/**
 * Update billing plan selection for an organization.
 */
export async function updateBillingPlan(orgId: string, plan: string): Promise<void> {
	const db = getDb();
	await db.update(organization).set({ billingPlan: plan }).where(eq(organization.id, orgId));
}

/**
 * Initialize billing state + shadow balance for an organization.
 * Used for trial start or plan activation.
 */
export async function initializeBillingState(
	orgId: string,
	state: string,
	shadowBalance: number,
): Promise<void> {
	const db = getDb();
	await db
		.update(organization)
		.set({
			billingState: state,
			shadowBalance: shadowBalance.toString(),
			shadowBalanceUpdatedAt: new Date(),
			graceEnteredAt: null,
			graceExpiresAt: null,
		})
		.where(eq(organization.id, orgId));
}

/**
 * List orgs with expired grace periods.
 */
export async function listGraceExpiredOrgs(): Promise<{ id: string }[]> {
	const db = getDb();
	const now = new Date();
	return db
		.select({ id: organization.id })
		.from(organization)
		.where(
			and(
				eq(organization.billingState, "grace"),
				or(isNull(organization.graceExpiresAt), lt(organization.graceExpiresAt, now)),
			),
		);
}

/**
 * Mark an org's grace period as expired (exhausted).
 */
export async function expireGraceForOrg(orgId: string): Promise<void> {
	const db = getDb();
	await db
		.update(organization)
		.set({
			billingState: "exhausted",
			graceEnteredAt: null,
			graceExpiresAt: null,
		})
		.where(eq(organization.id, orgId));
}

/**
 * Mark onboarding complete for an organization.
 */
export async function markOnboardingComplete(
	orgId: string,
	onboardingComplete = true,
): Promise<void> {
	const db = getDb();
	await db.update(organization).set({ onboardingComplete }).where(eq(organization.id, orgId));
}

/**
 * Mark onboarding complete for ALL organizations a user belongs to.
 * Prevents onboarding loops when the active org changes (e.g. back to personal workspace).
 */
export async function markAllUserOrgsOnboardingComplete(userId: string): Promise<void> {
	const db = getDb();
	const orgIds = await getUserOrgIds(userId);
	if (orgIds.length === 0) return;

	await db
		.update(organization)
		.set({ onboardingComplete: true })
		.where(and(inArray(organization.id, orgIds), eq(organization.onboardingComplete, false)));
}

/**
 * Check if a user has ANY org with onboarding complete.
 */
export async function hasAnyOrgCompletedOnboarding(userId: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.select({ id: organization.id })
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(and(eq(member.userId, userId), eq(organization.onboardingComplete, true)))
		.limit(1);

	return result.length > 0;
}

// ============================================
// Action Modes
// ============================================

/** Action mode type for the 3-mode permission cascade. */
export type ActionMode = "allow" | "require_approval" | "deny";

/** Action modes map: key → mode. */
export type ActionModesMap = Record<string, ActionMode>;

/**
 * Get action_modes JSONB for an organization.
 */
export async function getActionModes(orgId: string): Promise<ActionModesMap> {
	const db = getDb();
	const result = await db.query.organization.findFirst({
		where: eq(organization.id, orgId),
		columns: {
			actionModes: true,
		},
	});

	if (!result?.actionModes) return {};
	return result.actionModes as ActionModesMap;
}

/**
 * Set a single action mode entry (merge-patch into JSONB).
 */
export async function setActionMode(orgId: string, key: string, mode: ActionMode): Promise<void> {
	const db = getDb();
	const current = await getActionModes(orgId);
	const updated = { ...current, [key]: mode };
	await db.update(organization).set({ actionModes: updated }).where(eq(organization.id, orgId));
}

// ============================================
// Billing V2 Helpers
// ============================================

/**
 * Get billing info including V2 fields (shadow balance, billing state).
 */
export async function findBillingInfoV2(orgId: string): Promise<{
	id: string;
	name: string;
	billingSettings: OrgBillingSettings | null;
	autumnCustomerId: string | null;
	onboardingComplete: boolean | null;
	billingPlan: string | null;
	// V2 fields
	billingState: string;
	shadowBalance: string | null;
	shadowBalanceUpdatedAt: Date | null;
	graceEnteredAt: Date | null;
	graceExpiresAt: Date | null;
	// Overage fields
	overageUsedCents: number;
	overageCycleMonth: string | null;
	overageTopupCount: number;
	overageLastTopupAt: Date | null;
	overageDeclineAt: Date | null;
	lastReconciledAt: Date | null;
} | null> {
	const db = getDb();
	const result = await db.query.organization.findFirst({
		where: eq(organization.id, orgId),
		columns: {
			id: true,
			name: true,
			billingSettings: true,
			autumnCustomerId: true,
			onboardingComplete: true,
			billingPlan: true,
			billingState: true,
			shadowBalance: true,
			shadowBalanceUpdatedAt: true,
			graceEnteredAt: true,
			graceExpiresAt: true,
			overageUsedCents: true,
			overageCycleMonth: true,
			overageTopupCount: true,
			overageLastTopupAt: true,
			overageDeclineAt: true,
			lastReconciledAt: true,
		},
	});

	if (!result) return null;

	return {
		id: result.id,
		name: result.name,
		billingSettings: parseBillingSettings(result.billingSettings),
		autumnCustomerId: result.autumnCustomerId ?? null,
		onboardingComplete: result.onboardingComplete ?? null,
		billingPlan: result.billingPlan ?? null,
		// V2 fields
		billingState: result.billingState,
		shadowBalance: result.shadowBalance ?? null,
		shadowBalanceUpdatedAt: result.shadowBalanceUpdatedAt ?? null,
		graceEnteredAt: result.graceEnteredAt ?? null,
		graceExpiresAt: result.graceExpiresAt ?? null,
		// Overage fields
		overageUsedCents: result.overageUsedCents,
		overageCycleMonth: result.overageCycleMonth ?? null,
		overageTopupCount: result.overageTopupCount,
		overageLastTopupAt: result.overageLastTopupAt ?? null,
		overageDeclineAt: result.overageDeclineAt ?? null,
		lastReconciledAt: result.lastReconciledAt ?? null,
	};
}

// ============================================
// Overage State Queries
// ============================================

/**
 * Get overage state for an organization (first-class columns).
 */
export async function findOverageState(orgId: string): Promise<
	| (OrgOverageState & {
			billingSettings: OrgBillingSettings | null;
			autumnCustomerId: string | null;
			billingState: string;
			shadowBalance: string | null;
	  })
	| null
> {
	const db = getDb();
	const result = await db.query.organization.findFirst({
		where: eq(organization.id, orgId),
		columns: {
			billingSettings: true,
			autumnCustomerId: true,
			billingState: true,
			shadowBalance: true,
			overageUsedCents: true,
			overageCycleMonth: true,
			overageTopupCount: true,
			overageLastTopupAt: true,
			overageDeclineAt: true,
		},
	});

	if (!result) return null;

	return {
		billingSettings: parseBillingSettings(result.billingSettings),
		autumnCustomerId: result.autumnCustomerId ?? null,
		billingState: result.billingState,
		shadowBalance: result.shadowBalance ?? null,
		overageUsedCents: result.overageUsedCents,
		overageCycleMonth: result.overageCycleMonth ?? null,
		overageTopupCount: result.overageTopupCount,
		overageLastTopupAt: result.overageLastTopupAt ?? null,
		overageDeclineAt: result.overageDeclineAt ?? null,
	};
}

/**
 * Update overage state columns for an organization.
 */
export async function updateOverageState(
	orgId: string,
	updates: Partial<{
		overageUsedCents: number;
		overageCycleMonth: string | null;
		overageTopupCount: number;
		overageLastTopupAt: Date | null;
		overageDeclineAt: Date | null;
	}>,
): Promise<void> {
	const db = getDb();
	await db.update(organization).set(updates).where(eq(organization.id, orgId));
}

/**
 * Update last_reconciled_at timestamp for an organization.
 */
export async function updateLastReconciledAt(orgId: string): Promise<void> {
	const db = getDb();
	await db
		.update(organization)
		.set({ lastReconciledAt: new Date() })
		.where(eq(organization.id, orgId));
}
