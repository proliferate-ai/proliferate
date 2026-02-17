/**
 * Automations module exports.
 */

export * from "./service";
export { createFromTemplate, type CreateFromTemplateInput } from "./create-from-template";
export type {
	AutomationRow,
	AutomationWithRelations,
	AutomationWithTriggers as AutomationWithTriggersRow,
	AutomationConnectionWithIntegration,
	CreateAutomationInput as CreateAutomationDbInput,
	UpdateAutomationInput as UpdateAutomationDbInput,
	TriggerWithIntegration,
	TriggerEventRow,
	TriggerEventDetailRow,
	TriggerForAutomationRow,
	ListEventsOptions as DbListEventsOptions,
	ListEventsResult as DbListEventsResult,
	CreateTriggerForAutomationInput,
	WebhookTriggerWithAutomation,
	WebhookTriggerInfo,
	CreateTriggerEventInput as CreateTriggerEventDbInput,
	TriggerEventInsertRow,
	Json,
	PrebuildSummary,
	CreatorSummary,
	TriggerSummary,
	ScheduleSummary,
	IntegrationSummary,
} from "../types/automations";

// Re-export listAutomationConnections from db for internal session creation use
export { listAutomationConnections as listAutomationConnectionsInternal } from "./db";
