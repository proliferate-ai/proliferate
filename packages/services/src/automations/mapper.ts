/**
 * Automations mapper.
 *
 * Transforms DB rows (camelCase) to API types (snake_case).
 */

import { env } from "@proliferate/environment/server";
import type {
	Automation,
	AutomationEvent,
	AutomationEventDetail,
	AutomationListItem,
	AutomationTrigger,
	AutomationWithTriggers,
} from "@proliferate/shared/contracts";
import { toIsoString } from "../db/serialize";
import type {
	AutomationRow,
	AutomationWithRelations,
	AutomationWithTriggers as AutomationWithTriggersRow,
	PrebuildSummary,
	TriggerEventDetailRow,
	TriggerEventRow,
	TriggerForAutomationRow,
	TriggerWithIntegration,
} from "./db";

type TriggerProviderType =
	| "linear"
	| "sentry"
	| "github"
	| "gmail"
	| "webhook"
	| "scheduled"
	| "posthog"
	| "custom";
type TriggerTypeType = "webhook" | "polling";

const GATEWAY_URL = env.NEXT_PUBLIC_GATEWAY_URL;

/**
 * Transform a DB row (camelCase) to base Automation type (snake_case).
 */
export function toAutomation(
	row: AutomationRow & { defaultPrebuild?: PrebuildSummary | null },
): Automation {
	return {
		id: row.id,
		organization_id: row.organizationId,
		name: row.name,
		description: row.description,
		enabled: row.enabled ?? false,
		agent_instructions: row.agentInstructions,
		default_prebuild_id: row.defaultPrebuildId,
		allow_agentic_repo_selection: row.allowAgenticRepoSelection ?? false,
		agent_type: row.agentType,
		model_id: row.modelId,
		created_by: row.createdBy,
		created_at: toIsoString(row.createdAt) ?? new Date().toISOString(),
		updated_at: toIsoString(row.updatedAt) ?? new Date().toISOString(),
		default_prebuild: row.defaultPrebuild
			? {
					id: row.defaultPrebuild.id,
					name: row.defaultPrebuild.name,
					snapshot_id: row.defaultPrebuild.snapshotId,
				}
			: null,
		llm_filter_prompt: row.llmFilterPrompt ?? null,
		enabled_tools: (row.enabledTools as Record<string, unknown>) ?? null,
		llm_analysis_prompt: row.llmAnalysisPrompt ?? null,
		notification_channel_id: row.notificationChannelId ?? null,
		notification_slack_installation_id: row.notificationSlackInstallationId ?? null,
		source_template_id: row.sourceTemplateId ?? null,
	};
}

/**
 * Transform a DB row to AutomationListItem type (includes counts and active providers).
 */
export function toAutomationListItem(row: AutomationWithRelations): AutomationListItem {
	const triggers = row.triggers || [];
	const schedules = row.schedules || [];

	const activeProviders = [
		...new Set(
			triggers.filter((t) => t.enabled === true).map((t) => t.provider as TriggerProviderType),
		),
	];

	return {
		id: row.id,
		organization_id: row.organizationId,
		name: row.name,
		description: row.description,
		enabled: row.enabled ?? false,
		agent_instructions: row.agentInstructions,
		default_prebuild_id: row.defaultPrebuildId,
		allow_agentic_repo_selection: row.allowAgenticRepoSelection ?? false,
		agent_type: row.agentType,
		model_id: row.modelId,
		created_by: row.createdBy,
		created_at: toIsoString(row.createdAt) ?? new Date().toISOString(),
		updated_at: toIsoString(row.updatedAt) ?? new Date().toISOString(),
		default_prebuild: row.defaultPrebuild
			? {
					id: row.defaultPrebuild.id,
					name: row.defaultPrebuild.name,
					snapshot_id: row.defaultPrebuild.snapshotId,
				}
			: null,
		creator: row.createdByUser
			? {
					id: row.createdByUser.id,
					name: row.createdByUser.name,
					image: row.createdByUser.image,
				}
			: null,
		llm_filter_prompt: row.llmFilterPrompt ?? null,
		enabled_tools: (row.enabledTools as Record<string, unknown>) ?? null,
		llm_analysis_prompt: row.llmAnalysisPrompt ?? null,
		notification_channel_id: row.notificationChannelId ?? null,
		notification_slack_installation_id: row.notificationSlackInstallationId ?? null,
		source_template_id: row.sourceTemplateId ?? null,
		_count: {
			triggers: triggers.length,
			schedules: schedules.length,
		},
		activeProviders,
	};
}

/**
 * Transform a trigger row to AutomationTrigger type.
 */
export function toAutomationTrigger(trigger: TriggerWithIntegration): AutomationTrigger {
	return {
		id: trigger.id,
		provider: trigger.provider as TriggerProviderType,
		trigger_type: trigger.triggerType as TriggerTypeType,
		enabled: trigger.enabled,
		config: (trigger.config || {}) as Record<string, unknown>,
		webhook_url_path: trigger.webhookUrlPath,
		webhook_secret: trigger.webhookSecret,
		integration_id: trigger.integrationId,
		integration: trigger.integration
			? {
					id: trigger.integration.id,
					display_name: trigger.integration.displayName,
					status: trigger.integration.status || "unknown",
				}
			: null,
		name: trigger.name,
		webhookUrl:
			trigger.webhookUrlPath && GATEWAY_URL ? `${GATEWAY_URL}${trigger.webhookUrlPath}` : null,
	};
}

/**
 * Transform a DB row to AutomationWithTriggers type.
 */
export function toAutomationWithTriggers(row: AutomationWithTriggersRow): AutomationWithTriggers {
	return {
		id: row.id,
		organization_id: row.organizationId,
		name: row.name,
		description: row.description,
		enabled: row.enabled ?? false,
		agent_instructions: row.agentInstructions,
		default_prebuild_id: row.defaultPrebuildId,
		allow_agentic_repo_selection: row.allowAgenticRepoSelection ?? false,
		agent_type: row.agentType,
		model_id: row.modelId,
		created_by: row.createdBy,
		created_at: toIsoString(row.createdAt) ?? new Date().toISOString(),
		updated_at: toIsoString(row.updatedAt) ?? new Date().toISOString(),
		default_prebuild: row.defaultPrebuild
			? {
					id: row.defaultPrebuild.id,
					name: row.defaultPrebuild.name,
					snapshot_id: row.defaultPrebuild.snapshotId,
				}
			: null,
		llm_filter_prompt: row.llmFilterPrompt ?? null,
		enabled_tools: (row.enabledTools as Record<string, unknown>) ?? null,
		llm_analysis_prompt: row.llmAnalysisPrompt ?? null,
		notification_channel_id: row.notificationChannelId ?? null,
		notification_slack_installation_id: row.notificationSlackInstallationId ?? null,
		source_template_id: row.sourceTemplateId ?? null,
		triggers: (row.triggers || []).map(toAutomationTrigger),
	};
}

/**
 * Transform multiple rows to AutomationListItem types.
 */
export function toAutomationListItems(rows: AutomationWithRelations[]): AutomationListItem[] {
	return rows.map(toAutomationListItem);
}

/**
 * Create a new automation list item with empty counts.
 */
export function toNewAutomationListItem(
	row: AutomationRow & { defaultPrebuild?: PrebuildSummary | null },
): AutomationListItem {
	return {
		id: row.id,
		organization_id: row.organizationId,
		name: row.name,
		description: row.description,
		enabled: row.enabled ?? false,
		agent_instructions: row.agentInstructions,
		default_prebuild_id: row.defaultPrebuildId,
		allow_agentic_repo_selection: row.allowAgenticRepoSelection ?? false,
		agent_type: row.agentType,
		model_id: row.modelId,
		created_by: row.createdBy,
		created_at: toIsoString(row.createdAt) ?? new Date().toISOString(),
		updated_at: toIsoString(row.updatedAt) ?? new Date().toISOString(),
		default_prebuild: row.defaultPrebuild
			? {
					id: row.defaultPrebuild.id,
					name: row.defaultPrebuild.name,
					snapshot_id: row.defaultPrebuild.snapshotId,
				}
			: null,
		llm_filter_prompt: row.llmFilterPrompt ?? null,
		enabled_tools: (row.enabledTools as Record<string, unknown>) ?? null,
		llm_analysis_prompt: row.llmAnalysisPrompt ?? null,
		notification_channel_id: row.notificationChannelId ?? null,
		notification_slack_installation_id: row.notificationSlackInstallationId ?? null,
		source_template_id: row.sourceTemplateId ?? null,
		_count: { triggers: 0, schedules: 0 },
		activeProviders: [],
	};
}

type EventStatusType = "queued" | "processing" | "completed" | "failed" | "skipped" | "filtered";

/**
 * Transform a trigger event row to AutomationEvent type.
 */
export function toAutomationEvent(row: TriggerEventRow): AutomationEvent {
	return {
		id: row.id,
		external_event_id: row.externalEventId,
		provider_event_type: row.providerEventType,
		status: (row.status || "queued") as EventStatusType,
		parsed_context: (row.parsedContext || null) as Record<string, unknown> | null,
		error_message: row.errorMessage,
		skip_reason: row.skipReason,
		processed_at: toIsoString(row.processedAt),
		created_at: toIsoString(row.createdAt) ?? new Date().toISOString(),
		session_id: row.sessionId,
		trigger: row.trigger
			? {
					id: row.trigger.id,
					name: row.trigger.name,
					provider: row.trigger.provider as TriggerProviderType,
				}
			: null,
		session: row.session
			? {
					id: row.session.id,
					title: row.session.title,
					status: row.session.status ?? "unknown",
				}
			: null,
		enriched_data: (row.enrichedData || null) as Record<string, unknown> | null,
		llm_filter_result: (row.llmFilterResult || null) as Record<string, unknown> | null,
		llm_analysis_result: (row.llmAnalysisResult || null) as Record<string, unknown> | null,
	};
}

/**
 * Transform a trigger event detail row to AutomationEventDetail type.
 */
export function toAutomationEventDetail(row: TriggerEventDetailRow): AutomationEventDetail {
	const run = row.automationRuns?.[0] ?? null;
	return {
		id: row.id,
		external_event_id: row.externalEventId,
		provider_event_type: row.providerEventType,
		status: (row.status || "queued") as EventStatusType,
		parsed_context: (row.parsedContext || null) as Record<string, unknown> | null,
		error_message: row.errorMessage,
		skip_reason: row.skipReason,
		processed_at: toIsoString(row.processedAt),
		created_at: toIsoString(row.createdAt) ?? new Date().toISOString(),
		session_id: row.sessionId,
		enriched_data: (row.enrichedData || null) as Record<string, unknown> | null,
		llm_filter_result: (row.llmFilterResult || null) as Record<string, unknown> | null,
		llm_analysis_result: (row.llmAnalysisResult || null) as Record<string, unknown> | null,
		raw_payload: (row.rawPayload || null) as Record<string, unknown> | null,
		trigger: row.trigger
			? {
					id: row.trigger.id,
					name: row.trigger.name,
					provider: row.trigger.provider as TriggerProviderType,
					config: (row.trigger.config || {}) as Record<string, unknown>,
					automation: row.trigger.automation,
				}
			: null,
		session: row.session
			? {
					id: row.session.id,
					title: row.session.title,
					status: row.session.status ?? "unknown",
				}
			: null,
		run: run
			? {
					id: run.id,
					status: run.status,
					error_message: run.errorMessage,
					completed_at: toIsoString(run.completedAt),
					assigned_to: run.assignedTo ?? null,
					assignee: run.assignee
						? {
								id: run.assignee.id,
								name: run.assignee.name,
								email: run.assignee.email,
								image: run.assignee.image,
							}
						: null,
				}
			: null,
	};
}

/**
 * Transform a trigger row from listTriggersForAutomation to AutomationTrigger type.
 */
export function toAutomationTriggerFromRow(
	trigger: TriggerForAutomationRow,
	gatewayUrl?: string,
): AutomationTrigger {
	return {
		id: trigger.id,
		provider: trigger.provider as TriggerProviderType,
		trigger_type: trigger.triggerType as TriggerTypeType,
		enabled: trigger.enabled,
		config: (trigger.config || {}) as Record<string, unknown>,
		webhook_url_path: trigger.webhookUrlPath,
		webhook_secret: trigger.webhookSecret,
		integration_id: trigger.integrationId,
		integration: trigger.integration
			? {
					id: trigger.integration.id,
					display_name: trigger.integration.displayName,
					status: trigger.integration.status || "unknown",
				}
			: null,
		name: trigger.name,
		webhookUrl:
			trigger.webhookUrlPath && gatewayUrl ? `${gatewayUrl}${trigger.webhookUrlPath}` : null,
	};
}
