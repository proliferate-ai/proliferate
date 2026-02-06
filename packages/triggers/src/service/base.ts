import type { Request } from "express";
import type { z } from "zod";

// ============================================================================
// Type Registry - Single source of truth for trigger definitions
// ============================================================================

export const TRIGGERS = {
	github_event: "github",
	linear_event: "linear",
	sentry_event: "sentry",
	posthog_event: "posthog",
	gmail_message_received: "gmail",
} as const;

export type TriggerId = keyof typeof TRIGGERS;
export type Provider = (typeof TRIGGERS)[TriggerId];

// ============================================================================
// Shared Types
// ============================================================================

export interface TriggerEvent {
	type: TriggerId;
	externalId: string;
	timestamp: Date;
	payload: unknown;
	connectionId?: string;
	providerKey?: string;
}

export interface TriggerMetadata {
	name: string;
	description: string;
	icon: string;
}

export interface PollResult {
	events: TriggerEvent[];
	cursor: string | null;
}

export interface OAuthConnection {
	accessToken?: string;
	refreshToken?: string;
	connectionId?: string;
	provider?: string;
	metadata?: Record<string, unknown>;
}

// ============================================================================
// Trigger Base Classes
// ============================================================================

export abstract class WebhookTrigger<T extends TriggerId = TriggerId, TConfig = unknown> {
	abstract readonly id: T;
	abstract readonly provider: (typeof TRIGGERS)[T];
	abstract readonly metadata: TriggerMetadata;
	abstract readonly configSchema: z.ZodSchema<TConfig>;

	abstract webhook(req: Request): Promise<TriggerEvent[]>;
	abstract filter(event: TriggerEvent, config: TConfig): boolean;
	abstract idempotencyKey(event: TriggerEvent): string;
	abstract context(event: TriggerEvent): Record<string, unknown>;
}

export abstract class PollingTrigger<T extends TriggerId = TriggerId, TConfig = unknown> {
	abstract readonly id: T;
	abstract readonly provider: (typeof TRIGGERS)[T];
	abstract readonly metadata: TriggerMetadata;
	abstract readonly configSchema: z.ZodSchema<TConfig>;

	abstract poll(
		connection: OAuthConnection,
		config: TConfig,
		cursor: string | null,
	): Promise<PollResult>;
	abstract filter(event: TriggerEvent, config: TConfig): boolean;
	abstract idempotencyKey(event: TriggerEvent): string;
	abstract context(event: TriggerEvent): Record<string, unknown>;
}

export type TriggerDefinition = WebhookTrigger | PollingTrigger;
