/**
 * Central type definitions for database rows.
 *
 * These types represent the raw database schema (snake_case).
 * Use mappers to transform to API types (camelCase).
 *
 * Note: Some types have module-specific versions with the same name
 * but different shapes. Import from specific modules when needed:
 * - admin: UserRow, OrganizationRow, MembershipRow (for admin queries)
 * - orgs: OrganizationRow, MembershipRow (for org queries)
 * - integrations: UserRow (minimal user info for integrations)
 */

// Admin types (export with prefix to avoid conflicts)
export {
	UserRow as AdminUserRow,
	UserWithMembershipsRow,
	OrganizationRow as AdminOrganizationRow,
	OrganizationWithMembersRow,
	MembershipRow as AdminMembershipRow,
} from "./admin";

// Automations types
export * from "./automations";

// CLI types
export * from "./cli";

// Integrations types (export with prefix to avoid conflicts)
export {
	IntegrationRow,
	UserRow as IntegrationUserRow,
	IntegrationWithCreatorRow,
	SlackInstallationRow,
	RepoConnectionIntegrationRow,
	GitHubIntegrationRow,
	UpsertGitHubAppInstallationInput,
	GitHubAppIntegrationRow,
} from "./integrations";

// Onboarding types
export * from "./onboarding";

// Orgs types
export {
	OrganizationRow,
	MembershipRow,
	MemberRow,
	InvitationRow,
	DomainSuggestionRow,
} from "./orgs";

// Configurations types
export * from "./configurations";

// Repos types
export * from "./repos";

// Schedules types
export * from "./schedules";

// Secrets types
export * from "./secrets";

// Sessions types
export * from "./sessions";
