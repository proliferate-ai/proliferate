/**
 * Triggers module exports.
 */

export * from "./service";
export * from "./mapper";
export * from "./processor";

// Re-export types from central types file
export type {
	TriggerRow,
	TriggerWithIntegrationRow,
	TriggerWithAutomationRow,
	TriggerBasicRow,
	TriggerIntegrationRow,
	TriggerEventRow,
	TriggerEventWithRelationsRow,
	TriggerEventTriggerRow,
	TriggerEventSessionRow,
	CreateTriggerInput as DbCreateTriggerInput,
	CreateAutomationInput as DbCreateAutomationInput,
	CreateTriggerEventInput as DbCreateTriggerEventInput,
	UpdateTriggerInput as DbUpdateTriggerInput,
	ListEventsOptions as DbListEventsOptions,
	CreateSkippedEventInput as DbCreateSkippedEventInput,
} from "../types/triggers";

// Direct DB exports for webhook route (bypass service layer)
export {
	findTriggerWithAutomationById,
	findTriggerBasicById,
	findDuplicateEventByDedupKey,
	createEvent,
	findByIdWithIntegrationNoOrg,
	updatePollingState,
	updateEvent,
} from "./db";

// DB functions needed by GitHub App webhook handler
export { findActiveByIntegrationId, findEventByDedupKey, createSkippedEvent } from "./db";

// DB functions needed by Nango webhook handler
export { findActiveWebhookTriggers, eventExistsByDedupKey } from "./db";
