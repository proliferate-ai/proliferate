/**
 * @proliferate/services
 *
 * Server-side business logic and database operations.
 * Organized by feature with db/service/mapper pattern.
 */

// Feature modules
export * as actions from "./actions";
export * as admin from "./admin";
export * as baseSnapshots from "./base-snapshots";
export * as automations from "./automations";
export * as billing from "./billing";
export * as cli from "./cli";
export * as connectors from "./connectors";
export * as integrations from "./integrations";
export * as onboarding from "./onboarding";
export * as orgs from "./orgs";
export * as configurations from "./configurations";
export * as repos from "./repos";
export * as runs from "./runs";
export * as schedules from "./schedules";
export * as secretFiles from "./secret-files";
export * as secrets from "./secrets";
export * as sessions from "./sessions";
export * as sideEffects from "./side-effects";
export * as templates from "./templates";
export * as triggers from "./triggers";
export * as userActionPreferences from "./user-action-preferences";
export * as users from "./users";
export * as outbox from "./outbox";
export * as notifications from "./notifications";
export * as webhookInbox from "./webhook-inbox";
export * as pollGroups from "./poll-groups";

// Legacy exports (to be migrated)
export {
	getOrCreateManagedConfiguration,
	type GetOrCreateManagedConfigurationOptions,
	type ManagedConfiguration,
} from "./managed-configuration";

// Logger
export { setServicesLogger, getServicesLogger } from "./logger";

// Shared DB client
export { getDb, resetDb } from "./db/client";
