/**
 * Sessions module exports.
 */

export * from "./service";
export * from "./mapper";
export * from "./sandbox-env";
export * from "./generate-title";
// K-phase DB helpers (lifecycle, ACL) — defined in v1-db.ts
// Note: archiveSession/unarchiveSession/softDeleteSession are NOT re-exported from v1-db
// because v1-service.ts defines service-layer wrappers with the same names (object args + org check).
export {
	type CreateSessionEventInput,
	updateLastVisibleUpdateAt,
	updateOperatorStatus,
	createSessionEvent,
	listSessionEvents,
	getSessionAclRole,
	grantSessionAcl,
	updateSessionVisibility,
} from "./v1-db";

export * from "./v1-service";

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
	countNullPauseReasonSessions,
	getSessionCountsByOrganization,
	createSessionConnections,
	listSessionConnections,
	type SessionConnectionWithIntegration,
} from "./db";

// Gateway-specific exports (unified names)
export {
	create,
	update,
	deleteById,
	findByIdInternal,
	createSetupSession,
	createSetupSessionWithAdmissionGuard,
	createWithAdmissionGuard,
	updateWhereSandboxIdMatches,
	listRunningSessionIds,
	flushTelemetry,
} from "./db";
