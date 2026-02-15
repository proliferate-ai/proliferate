/**
 * @proliferate/providers — Core provider interfaces for the vNext architecture.
 *
 * These types define the contracts between integration providers, trigger sources,
 * and action adapters. All provider implementations must conform to these interfaces.
 */

// ============================================
// Risk Classification
// ============================================

export type RiskLevel = "read" | "write" | "danger";

// ============================================
// Integration Provider
// ============================================

/**
 * Defines an external integration provider (e.g., GitHub, Linear, Sentry, Slack).
 * Integration providers manage OAuth connections and expose actions/triggers.
 */
export interface IntegrationProvider {
	/** Unique provider identifier (e.g., "github", "linear", "sentry", "slack") */
	id: string;
	/** Human-readable display name */
	displayName: string;
	/** Provider category */
	category: "source_control" | "issue_tracker" | "monitoring" | "communication" | "custom";
	/** OAuth configuration key (e.g., Nango provider config key) */
	oauthConfigKey?: string;
	/** Whether this provider supports webhook triggers */
	supportsWebhooks: boolean;
	/** Whether this provider supports polling triggers */
	supportsPolling: boolean;
	/** Available action definitions for this provider */
	actions: ActionDefinition[];
	/** Available trigger event types for this provider */
	triggerEventTypes: TriggerEventType[];
}

/**
 * Defines a single action available on a provider.
 */
export interface ActionDefinition {
	/** Action name (e.g., "create_issue", "list_issues") */
	name: string;
	/** Human-readable description */
	description: string;
	/** Risk classification for approval flow */
	riskLevel: RiskLevel;
	/** Parameter schema */
	params: ActionParam[];
}

/**
 * Defines a parameter for an action.
 */
export interface ActionParam {
	name: string;
	type: "string" | "number" | "boolean" | "object" | "array";
	required: boolean;
	description: string;
	defaultValue?: unknown;
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
 * Result of executing an action against a provider.
 */
export interface ActionResult {
	/** Whether the action succeeded */
	success: boolean;
	/** Result data (provider-specific) */
	data?: unknown;
	/** Error message on failure */
	error?: string;
	/** Execution duration in milliseconds */
	durationMs?: number;
}

// ============================================
// Action Modes (vNext replacement for grants)
// ============================================

/**
 * Action mode configuration — replaces per-invocation grants with
 * declarative modes at the org or automation level.
 */
export interface ActionModes {
	/** Default mode for all actions */
	defaultMode?: ActionMode;
	/** Per-integration overrides */
	integrations?: Record<string, ActionMode>;
	/** Per-action overrides (integration:action format) */
	actions?: Record<string, ActionMode>;
}

/**
 * How an action should be handled when invoked.
 */
export type ActionMode =
	| "auto" // Auto-approve based on risk level (reads auto, writes auto, danger deny)
	| "approve" // Always require human approval
	| "deny"; // Always deny
