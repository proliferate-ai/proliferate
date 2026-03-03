import { z } from "zod";
import { TriggerProviderSchema, TriggerTypeSchema } from "./triggers";

// ============================================
// Schemas
// ============================================

// Configuration summary for automation responses
const ConfigurationSummarySchema = z
	.object({
		id: z.string().uuid(),
		name: z.string().nullable(),
		snapshot_id: z.string().nullable(),
	})
	.nullable();

// Creator info
const CreatorSchema = z
	.object({
		id: z.string(),
		name: z.string().nullable(),
		image: z.string().nullable(),
	})
	.nullable();

// Integration summary for triggers
const IntegrationSummarySchema = z
	.object({
		id: z.string().uuid(),
		display_name: z.string().nullable(),
		status: z.string(),
	})
	.nullable();

// Trigger schema for automation responses (subset of full trigger schema)
export const AutomationTriggerSchema = z.object({
	id: z.string().uuid(),
	provider: TriggerProviderSchema,
	trigger_type: TriggerTypeSchema,
	enabled: z.boolean().nullable(),
	config: z.record(z.unknown()),
	webhook_url_path: z.string().nullable(),
	webhook_secret: z.string().nullable(),
	integration_id: z.string().uuid().nullable(),
	integration: IntegrationSummarySchema.optional(),
	webhookUrl: z.string().nullable().optional(),
	name: z.string().nullable().optional(),
});

export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;

// Base automation schema
export const AutomationSchema = z.object({
	id: z.string().uuid(),
	organization_id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	enabled: z.boolean(),
	agent_instructions: z.string().nullable(),
	default_configuration_id: z.string().uuid().nullable(),
	allow_agentic_repo_selection: z.boolean(),
	agent_type: z.string().nullable().optional(),
	model_id: z.string().nullable().optional(),
	created_by: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
	default_configuration: ConfigurationSummarySchema.optional(),
	creator: CreatorSchema.optional(),
	llm_filter_prompt: z.string().nullable().optional(),
	enabled_tools: z.record(z.unknown()).nullable().optional(),
	llm_analysis_prompt: z.string().nullable().optional(),
	notification_destination_type: z.enum(["slack_dm_user", "slack_channel", "none"]).optional(),
	notification_channel_id: z.string().nullable().optional(),
	notification_slack_user_id: z.string().nullable().optional(),
	notification_slack_installation_id: z.string().uuid().nullable().optional(),
	config_selection_strategy: z.enum(["fixed", "agent_decide"]).optional(),
	fallback_configuration_id: z.string().uuid().nullable().optional(),
	allowed_configuration_ids: z.array(z.string().uuid()).nullable().optional(),
	source_template_id: z.string().nullable().optional(),
});

export type Automation = z.infer<typeof AutomationSchema>;

// Automation list item (includes counts and active providers)
export const AutomationListItemSchema = AutomationSchema.extend({
	_count: z.object({
		triggers: z.number(),
		schedules: z.number(),
	}),
	activeProviders: z.array(TriggerProviderSchema),
});

export type AutomationListItem = z.infer<typeof AutomationListItemSchema>;

// Automation with triggers (for get endpoint)
export const AutomationWithTriggersSchema = AutomationSchema.extend({
	triggers: z.array(AutomationTriggerSchema).optional(),
});

export type AutomationWithTriggers = z.infer<typeof AutomationWithTriggersSchema>;

// Create automation input
export const CreateAutomationInputSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	agentInstructions: z.string().optional(),
	defaultConfigurationId: z.string().uuid().optional(),
	allowAgenticRepoSelection: z.boolean().optional(),
});

export type CreateAutomationInput = z.infer<typeof CreateAutomationInputSchema>;

// Update automation input
export const UpdateAutomationInputSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	enabled: z.boolean().optional(),
	agentInstructions: z.string().optional(),
	defaultConfigurationId: z.string().uuid().nullable().optional(),
	allowAgenticRepoSelection: z.boolean().optional(),
	agentType: z.string().optional(),
	modelId: z.string().optional(),
	llmFilterPrompt: z.string().nullable().optional(),
	enabledTools: z.record(z.unknown()).nullable().optional(),
	llmAnalysisPrompt: z.string().nullable().optional(),
	notificationDestinationType: z.enum(["slack_dm_user", "slack_channel", "none"]).optional(),
	notificationChannelId: z.string().nullable().optional(),
	notificationSlackUserId: z.string().nullable().optional(),
	notificationSlackInstallationId: z.string().uuid().nullable().optional(),
	configSelectionStrategy: z.enum(["fixed", "agent_decide"]).optional(),
	fallbackConfigurationId: z.string().uuid().nullable().optional(),
	allowedConfigurationIds: z.array(z.string().uuid()).nullable().optional(),
});

export type UpdateAutomationInput = z.infer<typeof UpdateAutomationInputSchema>;

// Status for events in automation context
export const AutomationEventStatusSchema = z.enum([
	"queued",
	"processing",
	"completed",
	"failed",
	"skipped",
	"filtered",
]);

// Trigger event schema for automation events list
const TriggerSummarySchema = z.object({
	id: z.string().uuid(),
	name: z.string().nullable(),
	provider: TriggerProviderSchema,
});

const AssigneeSummarySchema = z
	.object({
		id: z.string(),
		name: z.string(),
		email: z.string(),
		image: z.string().nullable(),
	})
	.nullable();

const SessionSummarySchema = z
	.object({
		id: z.string().uuid(),
		title: z.string().nullable(),
		status: z.string(),
	})
	.nullable();

export const AutomationEventSchema = z.object({
	id: z.string().uuid(),
	external_event_id: z.string().nullable(),
	provider_event_type: z.string().nullable(),
	status: AutomationEventStatusSchema,
	parsed_context: z.record(z.unknown()).nullable(),
	error_message: z.string().nullable(),
	skip_reason: z.string().nullable(),
	processed_at: z.string().nullable(),
	created_at: z.string(),
	session_id: z.string().uuid().nullable(),
	trigger: TriggerSummarySchema.nullable().optional(),
	session: SessionSummarySchema.optional(),
	enriched_data: z.record(z.unknown()).nullable().optional(),
	llm_filter_result: z.record(z.unknown()).nullable().optional(),
	llm_analysis_result: z.record(z.unknown()).nullable().optional(),
});

export type AutomationEvent = z.infer<typeof AutomationEventSchema>;

// Detailed trigger event (includes raw_payload)
const TriggerDetailWithAutomationSchema = z.object({
	id: z.string().uuid(),
	name: z.string().nullable(),
	provider: TriggerProviderSchema,
	config: z.record(z.unknown()),
	automation: z
		.object({
			id: z.string().uuid(),
			name: z.string(),
		})
		.nullable()
		.optional(),
});

const RunSummarySchema = z
	.object({
		id: z.string().uuid(),
		status: z.string(),
		error_message: z.string().nullable(),
		completed_at: z.string().nullable(),
		assigned_to: z.string().nullable().optional(),
		assignee: AssigneeSummarySchema.optional(),
	})
	.nullable()
	.optional();

export const AutomationEventDetailSchema = AutomationEventSchema.extend({
	raw_payload: z.record(z.unknown()).nullable().optional(),
	trigger: TriggerDetailWithAutomationSchema.nullable().optional(),
	run: RunSummarySchema,
});

export type AutomationEventDetail = z.infer<typeof AutomationEventDetailSchema>;

// ============================================
// Automation Run schemas
// ============================================

export const AutomationRunStatusSchema = z.enum([
	"queued",
	"enriching",
	"ready",
	"running",
	"succeeded",
	"failed",
	"needs_human",
	"timed_out",
	"canceled",
	"skipped",
]);

export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;

const TriggerEventSummarySchema = z
	.object({
		id: z.string().uuid(),
		parsed_context: z.record(z.unknown()).nullable(),
		provider_event_type: z.string().nullable(),
	})
	.nullable();

export const AutomationRunSchema = z.object({
	id: z.string().uuid(),
	automation_id: z.string().uuid(),
	status: AutomationRunStatusSchema,
	status_reason: z.string().nullable(),
	error_message: z.string().nullable(),
	queued_at: z.string(),
	completed_at: z.string().nullable(),
	session_id: z.string().uuid().nullable(),
	assigned_to: z.string().nullable(),
	assigned_at: z.string().nullable(),
	trigger_event: TriggerEventSummarySchema,
	trigger: TriggerSummarySchema.nullable(),
	session: SessionSummarySchema,
	assignee: AssigneeSummarySchema,
	enrichment_json: z.record(z.unknown()).nullable().optional(),
});

export type AutomationRun = z.infer<typeof AutomationRunSchema>;

// Pending run summary schema (for attention tray)
export const PendingRunSummarySchema = z.object({
	id: z.string().uuid(),
	automation_id: z.string().uuid(),
	automation_name: z.string(),
	status: z.enum(["failed", "needs_human", "timed_out"]),
	status_reason: z.string().nullable(),
	error_message: z.string().nullable(),
	session_id: z.string().uuid().nullable(),
	assigned_to: z.string().nullable(),
	queued_at: z.string(),
	completed_at: z.string().nullable(),
});

export type PendingRunSummary = z.infer<typeof PendingRunSummarySchema>;

// Run event schema (status transitions and milestones)
export const AutomationRunEventSchema = z.object({
	id: z.string().uuid(),
	type: z.string(),
	from_status: z.string().nullable(),
	to_status: z.string().nullable(),
	data: z.record(z.unknown()).nullable(),
	created_at: z.string(),
});

export type AutomationRunEvent = z.infer<typeof AutomationRunEventSchema>;

// Trigger event action schema (tool execution audit log)
export const AutomationEventActionSchema = z.object({
	id: z.string().uuid(),
	tool_name: z.string(),
	status: z.string().nullable(),
	input_data: z.record(z.unknown()).nullable(),
	output_data: z.record(z.unknown()).nullable(),
	error_message: z.string().nullable(),
	started_at: z.string().nullable(),
	completed_at: z.string().nullable(),
	duration_ms: z.number().nullable(),
	created_at: z.string(),
});

export type AutomationEventAction = z.infer<typeof AutomationEventActionSchema>;

// Create trigger input for automation context
export const CreateAutomationTriggerInputSchema = z.object({
	provider: TriggerProviderSchema,
	triggerType: TriggerTypeSchema.optional(),
	integrationId: z.string().uuid().optional(),
	config: z.record(z.unknown()).optional(),
	enabled: z.boolean().optional(),
	cronExpression: z.string().optional(),
});

export type CreateAutomationTriggerInput = z.infer<typeof CreateAutomationTriggerInputSchema>;

// Create schedule input for automation context
export const CreateAutomationScheduleInputSchema = z.object({
	name: z.string().optional(),
	cronExpression: z.string(),
	timezone: z.string().optional(),
	enabled: z.boolean().optional(),
});

export type CreateAutomationScheduleInput = z.infer<typeof CreateAutomationScheduleInputSchema>;

// Automation connection schema (integration attached to an automation)
export const AutomationConnectionSchema = z.object({
	id: z.string().uuid(),
	automation_id: z.string().uuid(),
	integration_id: z.string().uuid(),
	created_at: z.string().nullable(),
	integration: z
		.object({
			id: z.string().uuid(),
			provider: z.string(),
			integration_id: z.string().nullable(),
			connection_id: z.string().nullable(),
			display_name: z.string().nullable(),
			status: z.string().nullable(),
		})
		.nullable(),
});

export type AutomationConnection = z.infer<typeof AutomationConnectionSchema>;
