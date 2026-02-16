/**
 * @proliferate/providers — Core provider interfaces for the vNext architecture.
 *
 * These types define the contracts between integration providers, trigger sources,
 * and action sources. All provider implementations must conform to these interfaces.
 */

import type { z } from "zod";

// ============================================
// Risk Classification
// ============================================

export type RiskLevel = "read" | "write" | "danger";

// ============================================
// Integration Provider
// ============================================

/**
 * Describes what connections a provider needs from the platform.
 * Providers declare abstract connection requirements; the platform resolves
 * them via Nango, direct OAuth, or API keys without the provider knowing how.
 */
export interface ConnectionRequirement {
	/** Connection type */
	type: "oauth2" | "api_key";
	/** Preset identifier used by the connection framework (e.g., "sentry", "linear") */
	preset: string;
	/** Human-readable label (e.g., "Sentry OAuth") */
	label?: string;
}

/**
 * Defines an external integration provider (e.g., GitHub, Linear, Sentry, Slack).
 * Integration providers declare connection requirements and expose triggers.
 *
 * Actions are NOT declared here — they live on ActionSource implementations,
 * which are discovered dynamically via listActions().
 */
export interface IntegrationProvider {
	/** Unique provider identifier (e.g., "github", "linear", "sentry", "slack") */
	id: string;
	/** Human-readable display name */
	displayName: string;
	/** Provider category */
	category: "source_control" | "issue_tracker" | "monitoring" | "communication" | "custom";
	/** Connection requirements — what the provider needs from the platform */
	connections: {
		org?: ConnectionRequirement;
		user?: ConnectionRequirement;
	};
	/** Whether this provider supports webhook triggers */
	supportsWebhooks: boolean;
	/** Whether this provider supports polling triggers */
	supportsPolling: boolean;
	/** Available trigger event types for this provider */
	triggerEventTypes: TriggerEventType[];
}

/**
 * Defines a single action available on a source.
 * Uses Zod for parameter validation — supports enums, nested objects,
 * and complex JSON Schema (critical for MCP connector tools).
 */
export interface ActionDefinition {
	/** Action identifier (e.g., "update_issue", "query_docs") */
	id: string;
	/** Human-readable description */
	description: string;
	/** Risk classification for approval flow */
	riskLevel: RiskLevel;
	/** Zod schema for parameter validation and introspection */
	params: z.ZodType;
}

/**
 * Defines a trigger event type that a provider can emit.
 */
export interface TriggerEventType {
	/** Event type identifier (e.g., "issues:opened", "push") */
	type: string;
	/** Human-readable description */
	description: string;
	/** Whether this event type is available via webhook */
	webhook: boolean;
	/** Whether this event type is available via polling */
	polling: boolean;
}

// ============================================
// Normalized Trigger Event
// ============================================

/**
 * A provider-agnostic representation of an inbound trigger event.
 * All provider-specific webhook/poll payloads are normalized to this shape
 * before entering the processing pipeline.
 */
export interface NormalizedTriggerEvent {
	/** Provider identifier (e.g., "github", "linear") */
	provider: string;
	/** Provider-specific event type (e.g., "issues:opened", "Issue:create") */
	eventType: string;
	/** Deduplication key — unique per provider+event to prevent double-processing */
	dedupKey: string;
	/** External event identifier from the provider */
	externalId?: string;
	/** Parsed context for prompt enrichment */
	context: TriggerEventContext;
	/** Raw provider payload (stored for audit, not used in processing) */
	rawPayload: unknown;
}

/**
 * Parsed context extracted from a trigger event, used for prompt enrichment.
 */
export interface TriggerEventContext {
	/** Short summary of the event for display */
	title: string;
	/** Longer description or body content */
	body?: string;
	/** URL to the event source (e.g., issue URL, PR URL) */
	url?: string;
	/** Author/actor of the event */
	author?: string;
	/** Repository or project context */
	repo?: string;
	/** Additional structured metadata */
	metadata?: Record<string, unknown>;
}

// ============================================
// Action Execution
// ============================================

/**
 * Result of executing an action against a source.
 */
export interface ActionResult {
	/** Whether the action succeeded */
	success: boolean;
	/** Result data (source-specific) */
	data?: unknown;
	/** Error message on failure */
	error?: string;
	/** Execution duration in milliseconds */
	durationMs?: number;
}

/**
 * Execution context passed to ActionSource.execute().
 * The platform resolves tokens/credentials and injects them here.
 */
export interface ActionExecutionContext {
	/** OAuth/API token for the integration (resolved by the platform) */
	token: string;
	/** Organization ID */
	orgId: string;
	/** Session ID (for audit trail) */
	sessionId: string;
}

// ============================================
// Action Modes (vNext replacement for grants)
// ============================================

/**
 * How an action should be handled when invoked.
 *
 * - allow:            Auto-execute without human approval
 * - require_approval: Pause and wait for human approval in the Inbox
 * - deny:             Reject the invocation outright
 */
export type ActionMode = "allow" | "require_approval" | "deny";

/**
 * Declarative action mode configuration — replaces per-invocation grants
 * with a 3-tier cascade: per-action → per-integration → default.
 */
export interface ActionModes {
	/** Default mode for all actions */
	defaultMode?: ActionMode;
	/** Per-integration overrides (keyed by source ID) */
	integrations?: Record<string, ActionMode>;
	/** Per-action overrides (keyed by "sourceId:actionId") */
	actions?: Record<string, ActionMode>;
}
