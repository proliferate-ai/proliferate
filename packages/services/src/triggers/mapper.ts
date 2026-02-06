/**
 * Triggers mapper.
 *
 * Transforms DB rows (camelCase) to API response types (snake_case).
 */

import type { Trigger, TriggerEvent, TriggerWithIntegration } from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import type {
	TriggerEventRow,
	TriggerEventWithRelationsRow,
	TriggerRow,
	TriggerWithIntegrationRow,
} from "./db";

/**
 * Map a DB trigger row (camelCase) to API Trigger type (snake_case).
 */
export function toTrigger(row: TriggerRow): Trigger {
	return {
		id: row.id,
		organization_id: row.organizationId,
		automation_id: row.automationId,
		name: row.name,
		description: row.description,
		trigger_type: row.triggerType,
		provider: row.provider,
		enabled: row.enabled,
		execution_mode: row.executionMode,
		allow_agentic_repo_selection: row.allowAgenticRepoSelection,
		agent_instructions: row.agentInstructions,
		webhook_url_path: row.webhookUrlPath,
		webhook_secret: row.webhookSecret,
		polling_cron: row.pollingCron,
		polling_endpoint: row.pollingEndpoint,
		polling_state: row.pollingState as Record<string, unknown> | null,
		last_polled_at: toIsoString(row.lastPolledAt),
		repeat_job_key: null, // Not in schema anymore
		config: row.config as Record<string, unknown> | null,
		integration_id: row.integrationId,
		created_by: row.createdBy,
		created_at: toIsoString(row.createdAt),
		updated_at: toIsoString(row.updatedAt),
	};
}

/**
 * Map a DB trigger row with integration to API TriggerWithIntegration type.
 */
export function toTriggerWithIntegration(
	row: TriggerWithIntegrationRow,
	pendingEventCount?: number,
): TriggerWithIntegration {
	return {
		...toTrigger(row),
		integration: row.integration
			? {
					id: row.integration.id,
					provider: row.integration.provider,
					integration_id: row.integration.integrationId,
					connection_id: row.integration.connectionId,
					display_name: row.integration.displayName,
					status: row.integration.status,
				}
			: null,
		pendingEventCount: pendingEventCount ?? 0,
	};
}

/**
 * Map multiple DB trigger rows with integrations to API types.
 */
export function toTriggersWithIntegration(
	rows: TriggerWithIntegrationRow[],
	pendingCounts: Record<string, number> = {},
): TriggerWithIntegration[] {
	return rows.map((row) => toTriggerWithIntegration(row, pendingCounts[row.id]));
}

/**
 * Map a DB trigger event row (camelCase) to API TriggerEvent type (snake_case).
 */
export function toTriggerEvent(row: TriggerEventRow): TriggerEvent {
	return {
		id: row.id,
		trigger_id: row.triggerId,
		organization_id: row.organizationId,
		status: row.status,
		raw_payload: row.rawPayload as Record<string, unknown>,
		parsed_context: row.parsedContext as Record<string, unknown> | null,
		external_event_id: row.externalEventId,
		provider_event_type: row.providerEventType,
		dedup_key: row.dedupKey,
		session_id: row.sessionId,
		error_message: row.errorMessage,
		skip_reason: row.skipReason,
		processed_at: toIsoString(row.processedAt),
		created_at: toIsoString(row.createdAt),
	};
}

/**
 * Map multiple DB trigger event rows to API types.
 */
export function toTriggerEvents(rows: TriggerEventRow[]): TriggerEvent[] {
	return rows.map(toTriggerEvent);
}

/**
 * Map a DB trigger event row with relations to API type with relations.
 */
export function toTriggerEventWithRelations(row: TriggerEventWithRelationsRow) {
	return {
		...toTriggerEvent(row),
		trigger: row.trigger,
		session: row.session,
	};
}

/**
 * Map multiple DB trigger event rows with relations to API types.
 */
export function toTriggerEventsWithRelations(rows: TriggerEventWithRelationsRow[]) {
	return rows.map(toTriggerEventWithRelations);
}
