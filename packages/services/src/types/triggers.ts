/**
 * Triggers module types.
 *
 * Re-exports from db.ts for backwards compatibility.
 */

// Re-export all types from the db module
export type {
	TriggerRow,
	TriggerEventRow,
	TriggerWithIntegrationRow,
	TriggerWithAutomationRow,
	TriggerEventWithRelationsRow,
	TriggerBasicRow,
	CreateTriggerInput,
	CreateAutomationInput,
	CreateTriggerEventInput,
	UpdateTriggerInput,
	ListEventsOptions,
	CreateSkippedEventInput,
} from "../triggers/db";

// Legacy type aliases for backwards compatibility with existing snake_case usage
// These are deprecated - use the camelCase types from db.ts instead
export interface TriggerIntegrationRow {
	id: string;
	provider: string;
	integration_id: string | null;
	connection_id: string | null;
	display_name: string | null;
	status: string | null;
}

export interface TriggerEventTriggerRow {
	id: string;
	name: string | null;
	provider: string;
}

export interface TriggerEventSessionRow {
	id: string;
	title: string | null;
	status: string | null;
}
