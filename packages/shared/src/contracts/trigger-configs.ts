/**
 * Provider-specific trigger configuration types.
 * Stored in the triggers.config JSONB column.
 */

export interface SentryTriggerConfig {
	projectSlug?: string;
	environments?: string[];
	minLevel?: "debug" | "info" | "warning" | "error" | "fatal";
}

export interface LinearTriggerConfig {
	triggerMethod?: "webhook" | "polling";
	teamId?: string;
	teamIds?: string[]; // Deprecated, use teamId
	stateFilters?: string[];
	priorityFilters?: number[];
	priorityFilter?: number[]; // Deprecated, use priorityFilters
	labelFilters?: string[];
	assigneeIds?: string[];
	projectIds?: string[];
	actionFilters?: ("create" | "update")[];
}

export interface GitHubTriggerConfig {
	triggerMethod?: "webhook";
	eventTypes?: (
		| "issues"
		| "pull_request"
		| "push"
		| "check_suite"
		| "check_run"
		| "workflow_run"
	)[];
	actionFilters?: string[];
	branchFilters?: string[];
	labelFilters?: string[];
	repoFilters?: string[];
	conclusionFilters?: (
		| "success"
		| "failure"
		| "cancelled"
		| "skipped"
		| "timed_out"
		| "action_required"
	)[];
}

export interface PostHogTriggerConfig {
	eventNames?: string[];
	propertyFilters?: Record<string, string>;
	requireSignatureVerification?: boolean;
}

export interface GmailTriggerConfig {
	labelIds?: string[];
	includeSpamTrash?: boolean;
	maxResults?: number;
	metadataHeaders?: string[];
}

export type TriggerConfig =
	| SentryTriggerConfig
	| LinearTriggerConfig
	| GitHubTriggerConfig
	| PostHogTriggerConfig
	| GmailTriggerConfig
	| Record<string, unknown>;

// ============================================
// Parsed event context types (extracted from webhook payloads)
// ============================================

export interface SentryParsedContext {
	errorType: string;
	errorMessage: string;
	stackTrace?: string;
	issueUrl: string;
	environment?: string;
	release?: string;
	projectSlug?: string;
}

export interface LinearParsedContext {
	issueId: string;
	issueNumber: number;
	title: string;
	description?: string;
	state: string;
	priority: number;
	labels?: string[];
	issueUrl: string;
	teamKey?: string;
}

export interface GitHubParsedContext {
	eventType: string;
	action?: string;
	repoFullName: string;
	repoUrl: string;
	sender?: string;
	issueNumber?: number;
	issueTitle?: string;
	issueBody?: string;
	issueUrl?: string;
	issueState?: string;
	labels?: string[];
	prNumber?: number;
	prTitle?: string;
	prBody?: string;
	prUrl?: string;
	prState?: string;
	baseBranch?: string;
	headBranch?: string;
	isDraft?: boolean;
	isMerged?: boolean;
	branch?: string;
	commits?: Array<{ sha: string; message: string; author?: string }>;
	compareUrl?: string;
	checkName?: string;
	conclusion?: string;
	workflowName?: string;
	workflowUrl?: string;
	errorMessage?: string;
	errorDetails?: string;
}

export interface GmailParsedContext {
	messageId: string;
	threadId?: string;
	subject?: string;
	from?: string;
	to?: string;
	date?: string;
	snippet?: string;
	labels?: string[];
}

export interface PostHogParsedContext {
	event: string;
	distinctId?: string;
	timestamp?: string;
	eventUrl?: string;
	properties?: Record<string, unknown>;
	person?: {
		id?: string;
		name?: string;
		url?: string;
		properties?: Record<string, unknown>;
	};
}

export interface ParsedEventContext {
	title: string;
	description?: string;
	relatedFiles?: string[];
	suggestedRepoId?: string;
	sentry?: SentryParsedContext;
	linear?: LinearParsedContext;
	github?: GitHubParsedContext;
	gmail?: GmailParsedContext;
	posthog?: PostHogParsedContext;
}
