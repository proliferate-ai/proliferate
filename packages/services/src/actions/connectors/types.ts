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

/** Result from calling a single MCP tool. */
export interface ConnectorCallResult {
	content: unknown;
	isError: boolean;
}
