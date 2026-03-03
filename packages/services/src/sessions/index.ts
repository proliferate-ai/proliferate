/**
 * Sessions module exports.
 */

export * from "./service";
export * from "./mapper";
export * from "./sandbox-env";
export * from "./pause";
export * from "./snapshot";
export * from "./submit-env";
export * from "./generate-title";
// K-phase DB helpers (lifecycle, ACL) — defined in db.ts
// Note: archiveSession/unarchiveSession/softDeleteSession are NOT re-exported from db
// because service.ts defines service-layer wrappers with the same names (object args + org check).
export {
	type CreateSessionEventInput,
	updateLastVisibleUpdateAt,
	updateOperatorStatus,
	createSessionEvent,
	listSessionEvents,
	getSessionAclRole,
	grantSessionAcl,
	updateSessionVisibility,
} from "./db";

// DB row types (from Drizzle schema)
export type {
	SessionRow,
	SessionWithRepoRow,
	EnrichedSessionRow,
	RepoRow as SessionRepoRow,
} from "./db";

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
	findSessionById,
	listChildSessionsByRun,
	listAllChildSessions,
	createSetupSession,
	createSetupSessionWithAdmissionGuard,
	createWithAdmissionGuard,
	createManagerSessionPlaceholder,
	promoteToManagerSession,
	updateManagerSessionLinkage,
	type CreateManagerSessionInput,
	updateWhereSandboxIdMatches,
	listRunningSessionIds,
	flushTelemetry,
	upsertSessionCapability,
	listSessionCapabilities,
	type SessionCapabilityRow,
	updateSessionMessageDeliveryState,
} from "./db";
