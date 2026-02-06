/**
 * Orgs mapper.
 *
 * Transforms Drizzle rows to API response types.
 */

import type {
	Invitation,
	Member,
	OrgRole,
	Organization,
	OrganizationWithRole,
} from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import type {
	DomainSuggestionRow,
	InvitationRow,
	MemberRow,
	MembershipRow,
	OrganizationRow,
} from "./db";

/**
 * Map a Drizzle organization row to API Organization type.
 */
export function toOrganization(row: OrganizationRow): Organization {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo,
		is_personal: row.isPersonal,
		allowed_domains: row.allowedDomains,
		createdAt: toIsoString(row.createdAt) ?? "",
	};
}

/**
 * Map a membership row to OrganizationWithRole type.
 */
export function toOrganizationWithRole(row: MembershipRow): OrganizationWithRole {
	return {
		id: row.organization.id,
		name: row.organization.name,
		slug: row.organization.slug,
		logo: row.organization.logo,
		is_personal: row.organization.isPersonal,
		allowed_domains: row.organization.allowedDomains,
		createdAt: toIsoString(row.organization.createdAt) ?? "",
		role: row.role as OrgRole,
	};
}

/**
 * Map multiple membership rows to OrganizationWithRole types.
 */
export function toOrganizationsWithRole(rows: MembershipRow[]): OrganizationWithRole[] {
	return rows.map(toOrganizationWithRole);
}

/**
 * Map a Drizzle member row to API Member type.
 */
export function toMember(row: MemberRow): Member {
	return {
		id: row.id,
		userId: row.userId,
		role: row.role as OrgRole,
		createdAt: toIsoString(row.createdAt) ?? "",
		user: row.user,
	};
}

/**
 * Map multiple member rows to Member types.
 */
export function toMembers(rows: MemberRow[]): Member[] {
	return rows.map(toMember);
}

/**
 * Map a Drizzle invitation row to API Invitation type.
 */
export function toInvitation(row: InvitationRow): Invitation {
	return {
		id: row.id,
		email: row.email,
		role: (row.role ?? "member") as OrgRole,
		status: row.status,
		expiresAt: toIsoString(row.expiresAt) ?? "",
		createdAt: toIsoString(row.createdAt) ?? "",
		inviter: row.inviter,
	};
}

/**
 * Map multiple invitation rows to Invitation types.
 */
export function toInvitations(rows: InvitationRow[]): Invitation[] {
	return rows.map(toInvitation);
}

/**
 * Map domain suggestion rows (simple passthrough).
 */
export function toDomainSuggestions(
	rows: DomainSuggestionRow[],
): Array<{ id: string; name: string; slug: string; logo: string | null }> {
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo,
	}));
}
