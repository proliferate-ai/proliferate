/**
 * Actions module exports.
 */

export * from "./service";

export {
	getAdapter,
	getGuide,
	listAdapters,
	type ActionAdapter,
	type ActionDefinition,
	type ActionParam,
} from "./adapters";

export type { ActionInvocationRow, ActionInvocationWithSession, CreateInvocationInput } from "./db";

export {
	createGrant,
	listActiveGrants,
	listGrantsByOrg,
	evaluateGrant,
	revokeGrant,
	getGrant,
	GrantNotFoundError,
	GrantExhaustedError,
	type EvaluateGrantResult,
} from "./grants";

export type { ActionGrantRow, CreateGrantInput } from "./grants-db";

// MCP connector module
export * as connectors from "./connectors";
