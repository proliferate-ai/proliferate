/**
 * Trigger Provider Interface
 *
 * Every trigger provider (Linear, Sentry, etc.) implements this interface.
 * This enables both webhook and polling mechanisms through a unified API.
 */

// Parsed context extracted from raw webhook payloads
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

	// Issue fields
	issueNumber?: number;
	issueTitle?: string;
	issueBody?: string;
	issueUrl?: string;
	issueState?: string;
	labels?: string[];

	// PR fields
	prNumber?: number;
	prTitle?: string;
	prBody?: string;
	prUrl?: string;
	prState?: string;
	baseBranch?: string;
	headBranch?: string;
	isDraft?: boolean;
	isMerged?: boolean;

	// Push fields
	branch?: string;
	commits?: Array<{
		sha: string;
		message: string;
		author?: string;
	}>;
	compareUrl?: string;

	// Check/workflow fields
	checkName?: string;
	conclusion?: string;
	workflowName?: string;
	workflowUrl?: string;

	// Error details (for check failures)
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

export interface PostHogWebhookEvent {
	event?: string;
	uuid?: string;
	distinct_id?: string;
	timestamp?: string;
	url?: string;
	properties?: Record<string, unknown>;
}

export interface PostHogWebhookPayload {
	event?: PostHogWebhookEvent | string;
	distinct_id?: string;
	properties?: Record<string, unknown>;
	timestamp?: string;
	person?: {
		id?: string;
		name?: string;
		url?: string;
		properties?: Record<string, unknown>;
	};
	[key: string]: unknown;
}

export interface PostHogItem {
	event: string;
	distinctId?: string;
	timestamp?: string;
	eventUrl?: string;
	properties?: Record<string, unknown>;
	person?: PostHogWebhookPayload["person"];
	uuid?: string;
	raw: PostHogWebhookPayload;
}

/**
 * State persisted between polling runs.
 * Stored in Redis for hot path, backed up to PostgreSQL.
 */
export interface PollState {
	maxTimestamp: string | null; // ISO timestamp of newest item seen
	seenIds: string[]; // Last 100 item IDs for dedup edge cases
	cursor?: string; // Optional pagination cursor
}

/**
 * OAuth connection from Nango (or similar)
 */
export interface OAuthConnection {
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: string;
	connectionId?: string;
	provider?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Result of polling an external API
 */
export interface PollResult<TItem, TState = PollState> {
	items: TItem[]; // All fetched items (provider sorts by timestamp)
	newState: TState; // State to persist for next poll
}

/**
 * Core trigger provider interface.
 * Implementations handle the specifics of each external service.
 *
 * @typeParam TConfig - Provider-specific configuration (filters, etc.)
 * @typeParam TState - State shape for polling (typically PollState)
 * @typeParam TItem - Raw item type from the provider API
 */
export interface TriggerProvider<TConfig, TState, TItem> {
	/**
	 * Poll the external API for items.
	 * Returns new items and updated state.
	 *
	 * @param connection - OAuth connection with access token
	 * @param config - User's filter config (teamId, etc.)
	 * @param lastState - Previous poll state (null = first poll)
	 * @returns Items fetched and new state to persist
	 * @throws Error if provider doesn't support polling
	 */
	poll(
		connection: OAuthConnection,
		config: TConfig,
		lastState: TState | null,
	): Promise<PollResult<TItem, TState>>;

	/**
	 * Find new items by comparing current items to last state.
	 * Default implementation: timestamp comparison.
	 *
	 * @param items - All items from current poll
	 * @param lastState - Previous poll state
	 * @returns Only the new items
	 */
	findNewItems(items: TItem[], lastState: TState | null): TItem[];

	/**
	 * Apply user's filter config to an item.
	 * Returns true if item should trigger a session.
	 *
	 * @param item - Raw item from API or webhook
	 * @param config - User's filter configuration
	 * @returns Whether the item passes all filters
	 */
	filter(item: TItem, config: TConfig): boolean;

	/**
	 * Parse item into context for the agent prompt.
	 *
	 * @param item - Raw item from API or webhook
	 * @returns Structured context for the AI agent
	 */
	parseContext(item: TItem): ParsedEventContext;

	/**
	 * Verify webhook signature.
	 * Only needed for webhook triggers.
	 *
	 * @param request - Incoming HTTP request
	 * @param secret - Webhook secret from trigger config
	 * @param body - Raw request body as string
	 * @returns Whether the signature is valid
	 */
	verifyWebhook(request: Request, secret: string, body: string): Promise<boolean>;

	/**
	 * Parse webhook payload into items.
	 * Only needed for webhook triggers.
	 *
	 * @param payload - Raw webhook payload
	 * @returns Array of items (empty if event type not supported)
	 */
	parseWebhook(payload: unknown): TItem[];

	/**
	 * Compute deduplication key for an item.
	 * Used to prevent processing the same event twice.
	 *
	 * @param item - Raw item from API or webhook
	 * @returns Dedup key string, or null if dedup not applicable
	 */
	computeDedupKey(item: TItem): string | null;

	/**
	 * Extract external event ID from item.
	 * Used for logging and tracking.
	 *
	 * @param item - Raw item from API or webhook
	 * @returns External event/issue ID
	 */
	extractExternalId(item: TItem): string;

	/**
	 * Get event type string for an item.
	 * Used for logging and filtering.
	 *
	 * @param item - Raw item from API or webhook
	 * @returns Event type string (e.g., "Issue:create")
	 */
	getEventType(item: TItem): string;
}

/**
 * Linear-specific configuration
 */
export interface LinearTriggerConfig {
	triggerMethod?: "webhook" | "polling";

	// Filters (all optional except teamId for polling)
	teamId?: string;
	stateFilters?: string[];
	priorityFilters?: number[];
	labelFilters?: string[];
	assigneeIds?: string[];
	projectIds?: string[];

	// Webhook-only
	actionFilters?: ("create" | "update")[];
}

/**
 * Sentry-specific configuration
 */
export interface SentryTriggerConfig {
	triggerMethod?: "webhook"; // Sentry only supports webhooks

	projectSlug?: string;
	environments?: string[];
	minLevel?: "debug" | "info" | "warning" | "error" | "fatal";
}

/**
 * GitHub-specific configuration
 */
export interface GitHubTriggerConfig {
	triggerMethod?: "webhook"; // GitHub only supports webhooks via Nango

	// Event types to trigger on
	eventTypes?: (
		| "issues"
		| "pull_request"
		| "push"
		| "check_suite"
		| "check_run"
		| "workflow_run"
	)[];

	// Action filters (e.g., "opened", "closed", "merged", "completed")
	actionFilters?: string[];

	// Branch filters (for push, pull_request events)
	branchFilters?: string[];

	// Label filters (for issues, pull_request events)
	labelFilters?: string[];

	// Repository filters (full name like "owner/repo")
	repoFilters?: string[];

	// Conclusion filters (for check_suite, check_run, workflow_run - e.g., "failure", "success")
	conclusionFilters?: (
		| "success"
		| "failure"
		| "cancelled"
		| "skipped"
		| "timed_out"
		| "action_required"
	)[];
}

/**
 * PostHog-specific configuration
 */
export interface PostHogTriggerConfig {
	eventNames?: string[];
	propertyFilters?: Record<string, string>;
	requireSignatureVerification?: boolean;
}

/**
 * Gmail-specific configuration
 */
export interface GmailTriggerConfig {
	labelIds?: string[];
	includeSpamTrash?: boolean;
	maxResults?: number;
	metadataHeaders?: string[];
}

/**
 * Union of all provider configs
 */
export type ProviderConfig =
	| LinearTriggerConfig
	| SentryTriggerConfig
	| GitHubTriggerConfig
	| PostHogTriggerConfig
	| GmailTriggerConfig
	| Record<string, unknown>;

/**
 * Linear issue type (from webhook or API)
 */
export interface LinearIssue {
	id: string;
	number?: number;
	title?: string;
	description?: string;
	state?: { id: string; name: string };
	priority?: number;
	labels?: { nodes: Array<{ id: string; name: string }> };
	assignee?: { id: string; name: string; email?: string };
	team?: { id: string; name: string; key: string };
	project?: { id: string; name: string };
	url?: string;
	createdAt?: string;
	updatedAt?: string;
}

/**
 * Linear webhook payload type
 */
export interface LinearWebhookPayloadInternal {
	action: "create" | "update" | "remove";
	type: "Issue" | "Comment" | "Project";
	createdAt: string;
	organizationId: string;
	webhookTimestamp: number;
	webhookId: string;
	url: string;
	actor: {
		id: string;
		type: string;
		name: string;
		email?: string;
	};
	data: LinearIssue;
	updatedFrom?: Record<string, unknown>;
}

/**
 * Sentry issue type (from webhook)
 */
export interface SentryIssue {
	id: string;
	title?: string;
	culprit?: string;
	shortId?: string;
	metadata?: {
		type?: string;
		value?: string;
		filename?: string;
	};
	status?: string;
	level?: string;
	platform?: string;
	project?: {
		id: string;
		name: string;
		slug: string;
	};
	tags?: Array<{ key: string; value: string }>;
}

/**
 * Sentry event type (from webhook)
 */
export interface SentryEvent {
	event_id: string;
	title?: string;
	message?: string;
	platform?: string;
	datetime?: string;
	tags?: Array<{ key: string; value: string }>;
	contexts?: Record<string, unknown>;
	exception?: {
		values: Array<{
			type: string;
			value: string;
			stacktrace?: {
				frames: Array<{
					filename: string;
					function: string;
					lineno: number;
					colno: number;
				}>;
			};
		}>;
	};
}

/**
 * Sentry webhook payload type
 */
export interface SentryWebhookPayloadInternal {
	action: string;
	data: {
		issue?: SentryIssue;
		event?: SentryEvent;
	};
	actor: {
		type: "user" | "application";
		id: string | number;
		name: string;
	};
}

/**
 * Combined Sentry item (issue + event data)
 */
export interface SentryItem {
	issue: SentryIssue;
	event?: SentryEvent;
	action: string;
}

/**
 * GitHub item type (normalized from various webhook events)
 */
export interface GitHubItem {
	id: string;
	eventType: "issues" | "pull_request" | "push" | "check_suite" | "check_run" | "workflow_run";
	action?: string;
	title?: string;
	body?: string;
	repoFullName?: string;
	repoUrl?: string;
	sender?: string;

	// Issue fields
	issueNumber?: number;
	issueTitle?: string;
	issueBody?: string;
	issueUrl?: string;
	issueState?: string;
	labels?: string[];

	// PR fields
	prNumber?: number;
	prTitle?: string;
	prBody?: string;
	prUrl?: string;
	prState?: string;
	baseBranch?: string;
	headBranch?: string;
	isDraft?: boolean;
	isMerged?: boolean;

	// Push fields
	branch?: string;
	commits?: Array<{
		sha: string;
		message: string;
		author?: string;
	}>;
	compareUrl?: string;

	// Check/workflow fields
	checkName?: string;
	conclusion?: string;
	workflowName?: string;
	workflowUrl?: string;

	// Error details (for check failures)
	errorMessage?: string;
	errorDetails?: string;

	// Related files (from commits or PR)
	relatedFiles?: string[];
}

/**
 * GitHub webhook payload (union of various event types)
 */
export interface GitHubWebhookPayload {
	action?: string;
	sender?: { login: string };
	repository?: {
		id: number;
		full_name: string;
		html_url: string;
	};

	// Issue event
	issue?: {
		id: number;
		number: number;
		title: string;
		body: string | null;
		html_url: string;
		state: string;
		labels?: Array<{ name: string }>;
	};

	// Pull request event
	pull_request?: {
		id: number;
		number: number;
		title: string;
		body: string | null;
		html_url: string;
		state: string;
		draft?: boolean;
		merged?: boolean;
		base?: { ref: string };
		head?: { ref: string };
		labels?: Array<{ name: string }>;
		changed_files?: number;
	};

	// Push event
	ref?: string;
	after?: string;
	compare?: string;
	pusher?: { name: string };
	commits?: Array<{
		id: string;
		message: string;
		author?: { name: string };
		added?: string[];
		modified?: string[];
		removed?: string[];
	}>;

	// Check suite event
	check_suite?: {
		id: number;
		head_branch: string;
		status: string;
		conclusion: string | null;
		app?: { name: string };
	};

	// Check run event
	check_run?: {
		id: number;
		name: string;
		status: string;
		conclusion: string | null;
		check_suite?: { head_branch: string };
		output?: {
			title: string | null;
			summary: string | null;
		};
	};

	// Workflow run event
	workflow_run?: {
		id: number;
		name: string;
		head_branch: string;
		status: string;
		conclusion: string | null;
		html_url: string;
		actor?: { login: string };
	};
}

/**
 * Provider type enum
 */
export type TriggerProviderType =
	| "linear"
	| "sentry"
	| "github"
	| "posthog"
	| "gmail"
	| "webhook"
	| "scheduled"
	| "custom";

/**
 * Get the correct provider implementation by type
 */
export function getProvider(type: TriggerProviderType): TriggerProvider<unknown, unknown, unknown> {
	// Import dynamically to avoid circular deps - implementations will register themselves
	const providers = getProviderRegistry();
	const provider = providers[type];
	if (!provider) {
		throw new Error(`Unknown trigger provider: ${type}`);
	}
	return provider as TriggerProvider<unknown, unknown, unknown>;
}

// Provider registry - populated by provider implementations
const providerRegistry: Record<string, TriggerProvider<unknown, unknown, unknown>> = {};

export function registerProvider(
	type: TriggerProviderType,
	provider: TriggerProvider<unknown, unknown, unknown>,
): void {
	providerRegistry[type] = provider;
}

export function getProviderRegistry(): Record<string, TriggerProvider<unknown, unknown, unknown>> {
	return providerRegistry;
}
