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
export * as prebuilds from "./prebuilds";
export * as repos from "./repos";
export * as runs from "./runs";
export * as schedules from "./schedules";
export * as secrets from "./secrets";
export * as sessions from "./sessions";
export * as sideEffects from "./side-effects";
export * as triggers from "./triggers";
export * as users from "./users";
export * as outbox from "./outbox";
export * as notifications from "./notifications";

// Legacy exports (to be migrated)
export {
	getOrCreateManagedPrebuild,
	type GetOrCreateManagedPrebuildOptions,
	type ManagedPrebuild,
} from "./managed-prebuild";

// Logger
export { setServicesLogger, getServicesLogger } from "./logger";

// Shared DB client
export { getDb, resetDb } from "./db/client";
