/**
 * Types for the MCP connector client module.
 */

import type { ActionDefinition } from "../adapters/types";

/** Tool list result from a single connector. */
export interface ConnectorToolList {
	connectorId: string;
	connectorName: string;
	actions: ActionDefinition[];
}

/** Extended tool list with drift detection results. */
export interface ConnectorToolListWithDrift extends ConnectorToolList {
	/** Per-tool drift status (true = tool definition has changed since last admin review) */
	driftStatus: Record<string, boolean>;
}

/** Result from calling a single MCP tool. */
export interface ConnectorCallResult {
	content: unknown;
	isError: boolean;
}
