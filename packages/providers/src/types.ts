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
	/** Internal normalized event type (e.g., "error_created", "issue_opened") */
	eventType: string;
	/** Native type from provider header/payload (e.g., "issue.created") */
	providerEventType: string;
	/** ISO 8601 timestamp of when the event occurred */
	occurredAt: string;
	/** Deduplication key — globally unique per provider+event */
	dedupKey: string;
	/** Short summary of the event for display */
	title: string;
	/** URL to the event source (e.g., issue URL, PR URL) */
	url?: string;
	/** External event identifier from the provider */
	externalId?: string;
	/** Parsed, structured context for prompt enrichment */
	context: Record<string, unknown>;
	/** Raw provider payload (stored for audit, not used in processing) */
	raw?: unknown;
}

// ============================================
// Webhook Ingestion
// ============================================

/**
 * Normalized representation of an inbound HTTP webhook request.
 * Passed to provider verify() and parse() methods.
 */
export interface WebhookRequest {
	method: string;
	path: string;
	headers: Record<string, string | string[] | undefined>;
	query: Record<string, string | undefined>;
	params: Record<string, string | undefined>;
	/** Raw body bytes — mandatory for accurate HMAC verification */
	rawBody: Buffer;
	body: unknown;
}

/**
 * Input to the provider's webhook parse() method.
 * Called by the async inbox worker after claiming a row.
 */
export interface WebhookParseInput {
	json: unknown;
	headers: Record<string, string | string[] | undefined>;
	providerEventType?: string;
	receivedAt: string;
}

/**
 * Result of webhook signature verification.
 */
export interface WebhookVerificationResult {
	ok: boolean;
	/** Routing identity — tells the framework how to resolve the org/integration */
	identity?: { kind: "org" | "integration" | "trigger"; id: string };
	/** Immediate response for challenge/handshake protocols (e.g., Slack, Jira) */
	immediateResponse?: { status: number; body?: unknown };
}

// ============================================
// Trigger Types & Provider Triggers
// ============================================

/**
 * A typed trigger definition within a provider.
 * The matches() function MUST be pure — no DB calls, no network, no side effects.
 */
export interface TriggerType<TConfig = unknown> {
	/** Trigger type identifier (e.g., "error_created", "issue_opened") */
	id: string;
	/** Human-readable description */
	description: string;
	/** Zod schema for trigger configuration validation */
	configSchema: z.ZodType<TConfig>;
	/** Pure matching function — determines if an event matches this trigger config */
	matches(event: NormalizedTriggerEvent, config: TConfig): boolean;
}

/**
 * The trigger contract that integration modules implement.
 * Providers are stateless — they never read PostgreSQL, write Redis, or schedule jobs.
 * The framework owns all persistence and deduplication.
 */
export interface ProviderTriggers {
	/** Available trigger type definitions */
	types: TriggerType[];

	/** Webhook ingestion — verify signatures and parse payloads */
	webhook?: {
		verify(req: WebhookRequest, secret: string | null): Promise<WebhookVerificationResult>;
		parse(input: WebhookParseInput): Promise<NormalizedTriggerEvent[]>;
	};

	/** Polling ingestion — fetch events from provider API */
	polling?: {
		defaultIntervalSeconds: number;
		poll(ctx: {
			cursor: unknown;
			token?: string;
			orgId: string;
		}): Promise<{
			events: NormalizedTriggerEvent[];
			nextCursor: unknown;
			backoffSeconds?: number;
		}>;
	};

	/**
	 * Optional hydration — called ONCE per event batch to fetch missing data
	 * (e.g., fetching Jira issue fields via API). Rate-limit aware.
	 */
	hydrate?: (
		event: NormalizedTriggerEvent,
		ctx: { token: string },
	) => Promise<NormalizedTriggerEvent>;
}

/**
 * Parsed context extracted from a trigger event, used for prompt enrichment.
 * @deprecated Use Record<string, unknown> context on NormalizedTriggerEvent directly.
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
