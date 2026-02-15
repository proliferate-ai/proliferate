/**
 * Action Source — Defines where an action definition originates.
 *
 * vNext unifies static adapters and connector-backed MCP sources
 * under a single ActionSource abstraction. The gateway uses this
 * to discover, authorize, and execute actions regardless of source type.
 */

import type { ActionDefinition, ActionResult, RiskLevel } from "./types";

// ============================================
// Action Source Types
// ============================================

/**
 * Discriminated union of action source types.
 */
export type ActionSourceType = "adapter" | "connector";

/**
 * Base interface for all action sources.
 */
export interface ActionSourceBase {
	/** Source type discriminator */
	type: ActionSourceType;
	/** Unique identifier for this source (adapter name or connector UUID) */
	id: string;
	/** Human-readable display name */
	displayName: string;
	/** Available action definitions */
	actions: ActionDefinition[];
	/** Optional markdown guide for agent consumption */
	guide?: string;
}

/**
 * A static adapter-based action source (e.g., Linear, Sentry, Slack).
 * These are hand-written integrations with OAuth token resolution.
 */
export interface AdapterActionSource extends ActionSourceBase {
	type: "adapter";
	/** Integration provider key (e.g., "linear", "sentry", "slack") */
	integration: string;
	/** Execute an action using the adapter */
	execute(action: string, params: Record<string, unknown>, token: string): Promise<ActionResult>;
}

/**
 * A connector-backed MCP action source.
 * These are dynamically discovered from org-scoped MCP connector configurations.
 */
export interface ConnectorActionSource extends ActionSourceBase {
	type: "connector";
	/** Connector UUID (stored as `connector:<uuid>` in invocation records) */
	connectorId: string;
	/** MCP server URL */
	url: string;
	/** Transport type */
	transport: "remote_http";
	/** Default risk level from connector config */
	defaultRisk: RiskLevel;
	/** Per-tool risk overrides from connector config */
	toolRiskOverrides?: Record<string, RiskLevel>;
}

/**
 * Union type for any action source.
 */
export type ActionSource = AdapterActionSource | ConnectorActionSource;

// ============================================
// Action Source Registry
// ============================================

/**
 * Describes a resolved set of action sources available to a session.
 * Merges adapter-based and connector-based sources.
 */
export interface ResolvedActionSources {
	/** All available sources (adapters + connectors) */
	sources: ActionSource[];
	/** Flat list of all available actions across all sources */
	allActions: Array<{
		source: ActionSource;
		action: ActionDefinition;
	}>;
}
