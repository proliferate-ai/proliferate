/**
 * Automation template type definitions.
 */

export type TemplateCategory = "bug-fixing" | "code-quality" | "project-management" | "devops";

export type TemplateProvider = "github" | "linear" | "sentry" | "posthog" | "gmail" | "custom";

export type TemplateTriggerType = "webhook" | "polling";

export interface TemplateTrigger {
	provider: TemplateProvider;
	triggerType: TemplateTriggerType;
	/** Provider-specific default filter config */
	config: Record<string, unknown>;
	/** Cron expression for polling triggers */
	cronExpression?: string;
}

export interface IntegrationRequirement {
	provider: "github" | "linear" | "sentry" | "slack" | "posthog" | "gmail";
	/** Human-readable reason (e.g., "Trigger source", "PR creation") */
	reason: string;
	/** true = gates instantiation, false = optional (skipped, flagged on detail page) */
	required: boolean;
}

export interface TemplateEnabledTools {
	slack_notify?: { enabled: boolean };
	create_linear_issue?: { enabled: boolean };
	email_user?: { enabled: boolean };
	create_session?: { enabled: boolean };
}

export interface AutomationTemplate {
	/** Unique key (e.g., "sentry-auto-fixer") */
	id: string;
	name: string;
	/** Short summary for the grid card */
	description: string;
	/** Longer description for the detail view */
	longDescription?: string;
	/** Lucide icon name */
	icon: string;
	category: TemplateCategory;

	/** Pre-written system prompt. May contain {{PLACEHOLDERS}} for user customization. */
	agentInstructions: string;
	/** LLM model ID. Defaults to "claude-sonnet-4-6". */
	modelId?: string;

	/** Trigger definitions to create atomically */
	triggers: TemplateTrigger[];

	/** Action toggles */
	enabledTools: TemplateEnabledTools;

	/**
	 * Suggested permission modes.
	 * NOTE: The backend forces all write-actions to "require_approval" regardless (security invariant S1).
	 */
	actionModes?: Record<string, "allow" | "require_approval" | "deny">;

	/** Integration dependencies — required ones gate instantiation */
	requiredIntegrations: IntegrationRequirement[];

	/** If true, detail page shows amber warning until repo is selected */
	requiresRepo: boolean;
}
