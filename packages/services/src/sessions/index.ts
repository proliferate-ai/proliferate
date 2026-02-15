/**
 * Sessions module exports.
 */

export * from "./service";
export * from "./mapper";
export * from "./sandbox-env";

// DB row types (from Drizzle schema)
export type { SessionRow, SessionWithRepoRow, RepoRow as SessionRepoRow } from "./db";

// Input/service types
export type {
	CreateSessionInput as DbCreateSessionInput,
	UpdateSessionInput as DbUpdateSessionInput,
	ListSessionsFilters,
	ListSessionsOptions,
	SessionStatus,
} from "../types/sessions";

// DB functions needed by sessions-create and repos-finalize
export {
	create as createSessionRecord,
	update as updateSessionRecord,
	findByIdInternal as findSessionByIdInternal,
	updateConfigurationId as updateSessionConfigurationId,
	markStopped as markSessionStopped,
	findBySlackThread as findSessionBySlackThread,
	getSessionClientInfo,
	countRunningByOrganization,
	getSessionCountsByOrganization,
	createSessionConnections,
	listSessionConnections,
	type SessionConnectionWithIntegration,
} from "./db";

// Gateway-specific exports (unified names)
export { create, update, deleteById, findByIdInternal, createSetupSession } from "./db";
