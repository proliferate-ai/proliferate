/**
 * Orgs module types.
 *
 * Re-exported from db module for backwards compatibility.
 * Types are now inferred from Drizzle schema.
 */

export type {
	OrganizationRow,
	MembershipRow,
	MemberRow,
	InvitationRow,
	DomainSuggestionRow,
} from "../orgs/db";
