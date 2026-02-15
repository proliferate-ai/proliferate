/**
 * Action Source — Polymorphic interface for action discovery and execution.
 *
 * vNext unifies static adapters (Sentry, Linear) and dynamic MCP connectors
 * (Context7, enterprise tools) under a single ActionSource interface.
 *
 * The Gateway's POST /invoke route calls source.execute() without knowing
 * whether the source uses REST, MCP, or any other protocol. This is the
 * core polymorphism that keeps the Gateway decoupled from execution details.
 *
 * Archetype A (Adapter): A ProviderActionSource wraps hand-written Sentry/Linear
 *   modules. listActions() returns static Zod-validated definitions.
 *   execute() calls the provider's REST API with an injected OAuth token.
 *
 * Archetype B (Connector): An McpConnectorActionSource wraps a DB row from
 *   org_connectors. listActions() dynamically discovers tools via MCP protocol.
 *   execute() calls the MCP server over stdio/SSE. No provider-specific code.
 */

import type { ActionDefinition, ActionExecutionContext, ActionResult, RiskLevel } from "./types";

// ============================================
// Action Source Interface
// ============================================

/**
 * A source of executable actions.
 *
 * Implementations MUST be stateless — all credentials, org context, and
 * connection details are resolved by the platform and injected via ctx.
 *
 * listActions() is async because MCP connectors discover tools over the network.
 * Adapter implementations may return a static list, but the interface must
 * accommodate dynamic discovery.
 */
export interface ActionSource {
	/** Unique source identifier (e.g., "sentry", "connector:ctx7-uuid") */
	id: string;
	/** Human-readable display name */
	displayName: string;
	/** Optional markdown guide for agent consumption */
	guide?: string;

	/**
	 * Discover available actions from this source.
	 * For adapters, this returns a static list.
	 * For MCP connectors, this queries the MCP server's tools/list endpoint.
	 */
	listActions(ctx: ActionExecutionContext): Promise<ActionDefinition[]>;

	/**
	 * Execute an action by ID with validated parameters.
	 * The platform resolves credentials and injects them via ctx.
	 */
	execute(
		actionId: string,
		params: Record<string, unknown>,
		ctx: ActionExecutionContext,
	): Promise<ActionResult>;
}

// ============================================
// Action Source Metadata
// ============================================

/**
 * Static metadata for a registered action source.
 * Used by the resolution layer to build ActionSource instances.
 */
export interface ActionSourceRegistration {
	/** Source identifier */
	id: string;
	/** Display name */
	displayName: string;
	/** Source origin: "adapter" for code-defined, "connector" for MCP DB rows */
	origin: "adapter" | "connector";
	/** Default risk level (connectors inherit from config) */
	defaultRisk?: RiskLevel;
	/** Per-action risk overrides (connectors only) */
	toolRiskOverrides?: Record<string, RiskLevel>;
}

/**
 * Describes a resolved set of action sources available to a session.
 * Built by the resolution layer from adapters + org connector rows.
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
