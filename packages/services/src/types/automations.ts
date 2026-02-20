/**
 * Automations type definitions.
 *
 * Input types for DB operations.
 * DB row types are defined in automations/db.ts.
 */

// Re-export DB types for backwards compatibility
export type {
	AutomationRow,
	AutomationWithRelations,
	AutomationWithTriggers,
	AutomationConnectionWithIntegration,
	CreatorSummary,
	IntegrationSummary,
	ListEventsResult,
	ConfigurationSummary,
	ScheduleSummary,
	TriggerEventDetailRow,
	TriggerEventInsertRow,
	TriggerEventRow,
	TriggerForAutomationRow,
	TriggerSummary,
	TriggerWithIntegration,
	WebhookTriggerInfo,
	WebhookTriggerWithAutomation,
} from "../automations/db";

// JSON type for Drizzle fields
export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

// ============================================
// Input types
// ============================================

export interface CreateAutomationInput {
	organizationId: string;
	name: string;
	description?: string | null;
	agentInstructions?: string | null;
	defaultConfigurationId?: string | null;
	allowAgenticRepoSelection?: boolean;
	createdBy: string;
}

export interface UpdateAutomationInput {
	name?: string;
	description?: string | null;
	enabled?: boolean;
	agentInstructions?: string | null;
	defaultConfigurationId?: string | null;
	allowAgenticRepoSelection?: boolean;
	agentType?: string | null;
	modelId?: string | null;
	llmFilterPrompt?: string | null;
	enabledTools?: Record<string, unknown> | null;
	llmAnalysisPrompt?: string | null;
	notificationDestinationType?: string | null;
	notificationChannelId?: string | null;
	notificationSlackUserId?: string | null;
	notificationSlackInstallationId?: string | null;
	configSelectionStrategy?: string | null;
	fallbackConfigurationId?: string | null;
	allowedConfigurationIds?: string[] | null;
}

// ============================================
// List events options
// ============================================

export interface ListEventsOptions {
	status?: string;
	limit: number;
	offset: number;
}

// ============================================
// Trigger types
// ============================================

export interface CreateTriggerForAutomationInput {
	automationId: string;
	organizationId: string;
	name: string;
	provider: string;
	triggerType: string;
	enabled: boolean;
	config: Json;
	integrationId: string | null;
	webhookUrlPath: string;
	webhookSecret: string;
	pollingCron: string | null;
	createdBy: string;
}

// ============================================
// Trigger event types
// ============================================

export interface CreateTriggerEventInput {
	triggerId: string;
	organizationId: string;
	externalEventId: string;
	providerEventType: string;
	rawPayload: Json;
	parsedContext: Json;
	dedupKey: string;
	status: string;
}
