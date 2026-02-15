// Message types for Client <-> Durable Object WebSocket communication

import type { AutoStartOutputEntry, ServiceCommand } from "./sandbox-provider";

// Client source - where the message originated from
export type ClientSource = "slack" | "web" | "api" | "cli" | "automation";

export interface ToolCall {
	id: string;
	tool: string;
	args: unknown;
	result?: unknown;
	status: "pending" | "running" | "completed" | "error";
	startedAt: number;
	completedAt?: number;
}

// Part types for ordered message content
export interface TextPart {
	type: "text";
	text: string;
}

export interface ImagePart {
	type: "image";
	image: string; // Data URI or URL
}

export interface ToolPart {
	type: "tool";
	toolCallId: string;
	toolName: string;
	args: unknown;
	result?: unknown;
	status: "pending" | "running" | "completed" | "error";
}

export type MessagePart = TextPart | ImagePart | ToolPart;

export interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	isComplete: boolean;
	createdAt: number;
	senderId?: string;
	source?: ClientSource;
	toolCalls?: ToolCall[];
	// Ordered parts array - maintains tool/text interleaving order
	parts?: MessagePart[];
}

// Client -> DO messages
export interface PromptMessage {
	type: "prompt";
	content: string;
	/**
	 * Deprecated: the gateway should derive identity from the authenticated connection.
	 * This field is ignored server-side when present.
	 */
	userId?: string;
	/** Images as data URIs (e.g., "data:image/png;base64,ABC...") */
	images?: string[];
}

export interface PingMessage {
	type: "ping";
}

export interface CancelMessage {
	type: "cancel";
	/**
	 * Deprecated: the gateway should derive identity from the authenticated connection.
	 * This field is ignored server-side when present.
	 */
	userId?: string;
}

export interface GetStatusMessage {
	type: "get_status";
}

export interface GetMessagesMessage {
	type: "get_messages";
}

export interface SaveSnapshotMessage {
	type: "save_snapshot";
	message?: string;
}

export interface RunAutoStartMessage {
	type: "run_auto_start";
	runId: string;
	mode?: "test" | "start";
	commands?: ServiceCommand[];
}

// ============================================
// Git Management Types
// ============================================

export interface GitFileChange {
	path: string;
	/** Index (staged) status character from XY in git status --porcelain */
	indexStatus: string;
	/** Worktree (unstaged) status character from XY in git status --porcelain */
	worktreeStatus: string;
}

export interface GitCommitSummary {
	sha: string;
	message: string;
	author: string;
	date: string;
}

export type GitResultCode =
	| "SUCCESS"
	| "NOTHING_TO_COMMIT"
	| "NO_REMOTE"
	| "NOT_A_REPO"
	| "SHALLOW_PUSH_FAILED"
	| "AUTH_FAILED"
	| "GH_NOT_AVAILABLE"
	| "NOT_GITHUB_REMOTE"
	| "BRANCH_EXISTS"
	| "MERGE_CONFLICT"
	| "REPO_BUSY"
	| "MULTIPLE_REMOTES"
	| "UNKNOWN_ERROR";

export interface GitState {
	branch: string;
	detached: boolean;
	stagedChanges: GitFileChange[];
	unstagedChanges: GitFileChange[];
	untrackedFiles: string[];
	conflictedFiles: string[];
	commits: GitCommitSummary[];
	/** Commits ahead of upstream. null = unknown (shallow or no upstream) */
	ahead: number | null;
	/** Commits behind upstream. null = unknown (shallow or no upstream) */
	behind: number | null;
	isShallow: boolean;
	/** True when .git/index.lock exists (another git process is running) */
	isBusy: boolean;
	rebaseInProgress: boolean;
	mergeInProgress: boolean;
}

// ============================================
// Git Client Messages
// ============================================

export interface GetGitStatusMessage {
	type: "get_git_status";
	workspacePath?: string;
}

export interface GitCreateBranchMessage {
	type: "git_create_branch";
	branchName: string;
	workspacePath?: string;
}

export interface GitCommitMessage {
	type: "git_commit";
	message: string;
	/** If true, stages untracked files too (git add -A). Default: false (git add -u). */
	includeUntracked?: boolean;
	/** Specific files to stage. If provided, only these files are staged. */
	files?: string[];
	workspacePath?: string;
}

export interface GitPushMessage {
	type: "git_push";
	workspacePath?: string;
}

export interface GitCreatePrMessage {
	type: "git_create_pr";
	title: string;
	body?: string;
	baseBranch?: string;
	workspacePath?: string;
}

// ============================================
// Git Server Messages
// ============================================

export interface GitStatusMessage {
	type: "git_status";
	payload: GitState;
}

export interface GitResultMessage {
	type: "git_result";
	payload: {
		action: string;
		success: boolean;
		code: GitResultCode;
		message: string;
		prUrl?: string;
	};
}

export type ClientMessage =
	| PromptMessage
	| PingMessage
	| CancelMessage
	| GetStatusMessage
	| GetMessagesMessage
	| SaveSnapshotMessage
	| RunAutoStartMessage
	| GetGitStatusMessage
	| GitCreateBranchMessage
	| GitCommitMessage
	| GitPushMessage
	| GitCreatePrMessage;

// DO -> Client messages
export interface InitMessage {
	type: "init";
	payload: {
		messages: Message[];
		config?: Partial<SessionConfig>;
	};
}

export interface NewMessageEvent {
	type: "message";
	payload: Message;
}

export interface TokenMessage {
	type: "token";
	payload: {
		messageId: string;
		partId: string;
		token: string;
	};
}

export interface TextPartCompleteMessage {
	type: "text_part_complete";
	payload: {
		messageId: string;
		partId: string;
		text: string;
	};
}

export interface MessageCompleteMessage {
	type: "message_complete";
	payload: {
		messageId: string;
	};
}

export interface ToolStartMessage {
	type: "tool_start";
	payload: {
		messageId?: string;
		partId: string;
		toolCallId: string;
		tool: string;
		args: unknown;
	};
}

export interface ToolEndMessage {
	type: "tool_end";
	payload: {
		partId: string;
		toolCallId: string;
		tool: string;
		result: unknown;
		durationMs: number;
	};
}

export interface TaskToolSummaryItem {
	id: string;
	tool: string;
	state: {
		status: string;
		title?: string;
	};
}

export interface ToolMetadataMessage {
	type: "tool_metadata";
	payload: {
		toolCallId: string;
		tool: string;
		title?: string;
		metadata?: {
			summary?: TaskToolSummaryItem[];
			sessionId?: string;
		};
	};
}

export interface FileEditMessage {
	type: "file_edit";
	payload: {
		path: string;
		diff: string;
	};
}

export interface ArtifactCreatedMessage {
	type: "artifact_created";
	payload: {
		path: string;
		title: string;
	};
}

export interface SessionPausedMessage {
	type: "session_paused";
}

export interface SessionResumedMessage {
	type: "session_resumed";
}

export interface ErrorMessage {
	type: "error";
	payload: {
		message: string;
	};
}

export interface PongMessage {
	type: "pong";
}

export interface TitleUpdateMessage {
	type: "title_update";
	payload: {
		title: string;
	};
}

export interface PreviewUrlMessage {
	type: "preview_url";
	payload: {
		url: string;
	};
}

export interface MessageCancelledMessage {
	type: "message_cancelled";
	payload: {
		messageId?: string; // Optional - cancel may happen before assistant message exists
	};
}

export interface StatusMessage {
	type: "status";
	payload: {
		status: "creating" | "resuming" | "running" | "paused" | "stopped" | "error" | "migrating";
		message?: string;
	};
}

export interface SnapshotResultMessage {
	type: "snapshot_result";
	payload: {
		success: boolean;
		snapshotId?: string;
		error?: string;
		target: "configuration" | "session";
	};
}

export interface AutoStartOutputMessage {
	type: "auto_start_output";
	payload: {
		runId: string;
		entries: AutoStartOutputEntry[];
	};
}

export interface ActionApprovalRequestMessage {
	type: "action_approval_request";
	payload: {
		invocationId: string;
		integration: string;
		action: string;
		riskLevel: string;
		params: unknown;
		expiresAt: string;
	};
}

export interface ActionApprovalResultMessage {
	type: "action_approval_result";
	payload: {
		invocationId: string;
		status: "approved" | "denied";
		approvedBy?: string;
	};
}

export interface ActionCompletedMessage {
	type: "action_completed";
	payload: {
		invocationId: string;
		status: "completed" | "failed";
		result?: unknown;
		error?: string;
	};
}

export type ServerMessage =
	| InitMessage
	| NewMessageEvent
	| TokenMessage
	| TextPartCompleteMessage
	| MessageCompleteMessage
	| MessageCancelledMessage
	| ToolStartMessage
	| ToolEndMessage
	| ToolMetadataMessage
	| FileEditMessage
	| ArtifactCreatedMessage
	| SessionPausedMessage
	| SessionResumedMessage
	| ErrorMessage
	| PongMessage
	| TitleUpdateMessage
	| PreviewUrlMessage
	| StatusMessage
	| SnapshotResultMessage
	| AutoStartOutputMessage
	| GitStatusMessage
	| GitResultMessage
	| ActionApprovalRequestMessage
	| ActionApprovalResultMessage
	| ActionCompletedMessage;

export * from "./auth";

// Sandbox -> DO events
export interface SandboxTokenEvent {
	type: "token";
	payload: {
		text: string;
	};
}

export interface SandboxToolStartEvent {
	type: "tool_start";
	payload: {
		tool: string;
		args: unknown;
	};
}

export interface SandboxToolEndEvent {
	type: "tool_end";
	payload: {
		tool: string;
		args: unknown;
		result: unknown;
		durationMs: number;
	};
}

export interface SandboxFileEditEvent {
	type: "file_edit";
	payload: {
		path: string;
		diff: string;
	};
}

export interface SandboxCompleteEvent {
	type: "complete";
	payload: Record<string, never>;
}

export interface SandboxErrorEvent {
	type: "error";
	payload: {
		message: string;
	};
}

export type SandboxEvent =
	| SandboxTokenEvent
	| SandboxToolStartEvent
	| SandboxToolEndEvent
	| SandboxFileEditEvent
	| SandboxCompleteEvent
	| SandboxErrorEvent;

// Slack context for sessions initiated from Slack
export interface SlackContext {
	installationId: string;
	channelId: string;
	threadTs: string;
	encryptedBotToken: string;
}

// Session config stored in DO
export interface SessionConfig {
	sessionId: string;
	repoId: string;
	orgId: string;
	userId: string;
	openCodeTunnelUrl?: string;
	openCodeSessionId?: string;
	slackContext?: SlackContext;
	previewTunnelUrl?: string;
}

// Session status
export type SessionStatus = "starting" | "running" | "paused" | "stopped" | "failed";

// Configuration status
export type ConfigurationStatus = "pending" | "building" | "ready" | "failed";

// ============================================
// Verification Types
// ============================================

// Default folder where agents build verification evidence
export const VERIFICATION_FOLDER = ".proliferate/.verification";

// ============================================
// Preview Manifest Types
// ============================================

/**
 * Preview manifest for defining dev server ports.
 * File: .proliferate/previews.json
 */
export interface PreviewManifest {
	previews: PreviewEntry[];
}

export interface PreviewEntry {
	name: string; // Display name (e.g., "Frontend", "API")
	port: number; // Port number (e.g., 3000, 8000)
	path?: string; // Optional path (e.g., "/", "/docs")
}

export interface VerificationArgs {
	folder?: string; // Defaults to .proliferate/.verification
}

export interface VerificationResult {
	key: string; // S3 prefix where files were uploaded (e.g., "sessions/{sessionId}/verification/{timestamp}")
}

// File metadata returned when listing verification files from S3
export interface VerificationFile {
	key: string; // Full S3 object key
	name: string; // Filename only
	path: string; // Relative path from the prefix (e.g., "screenshots/home.png")
	contentType: string; // MIME type from S3 metadata or inferred from extension
	size: number; // File size in bytes
	lastModified: string; // ISO timestamp
}

// ============================================
// Trigger Types
// ============================================

export type TriggerType = "webhook" | "polling";
export type TriggerProvider =
	| "sentry"
	| "linear"
	| "github"
	| "posthog"
	| "gmail"
	| "webhook"
	| "scheduled"
	| "custom";
export type ExecutionMode = "auto" | "queue";
export type TriggerEventStatus = "queued" | "processing" | "completed" | "failed" | "skipped";

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

// Provider-specific config shapes (stored in triggers.config JSONB)
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

// Sentry webhook payload types
export interface SentryWebhookPayload {
	action: string;
	data: {
		issue?: {
			id: string;
			title: string;
			culprit: string;
			shortId: string;
			metadata: {
				type: string;
				value: string;
				filename?: string;
			};
			status: string;
			level: string;
			platform: string;
			project: {
				id: string;
				name: string;
				slug: string;
			};
		};
		event?: {
			event_id: string;
			title: string;
			message: string;
			platform: string;
			datetime: string;
			tags: Array<{ key: string; value: string }>;
			contexts: Record<string, unknown>;
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
		};
	};
	actor: {
		type: "user" | "application";
		id: string | number;
		name: string;
	};
}

// Linear webhook payload types
export interface LinearWebhookPayload {
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
	data: {
		id: string;
		number?: number;
		title?: string;
		description?: string;
		state?: { id: string; name: string };
		priority?: number;
		labels?: { nodes: Array<{ id: string; name: string }> };
		assignee?: { id: string; name: string; email?: string };
		team?: { id: string; name: string; key: string };
		url?: string;
	};
	updatedFrom?: Record<string, unknown>;
}

// ============================================
// Automation Types
// ============================================

export interface Automation {
	id: string;
	organization_id: string;
	name: string;
	description: string | null;
	enabled: boolean;
	agent_instructions: string | null;
	default_repo_id: string | null;
	allow_agentic_repo_selection: boolean;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface Schedule {
	id: string;
	automation_id: string;
	organization_id: string;
	name: string | null;
	cron_expression: string;
	timezone: string;
	enabled: boolean;
	last_run_at: string | null;
	next_run_at: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

// Automation with related data (for API responses)
export interface AutomationWithRelations extends Automation {
	triggers?: Array<{
		id: string;
		provider: TriggerProvider;
		trigger_type: TriggerType;
		enabled: boolean;
		config: TriggerConfig;
		webhook_url_path: string | null;
		integration?: {
			id: string;
			display_name: string | null;
			status: string;
		} | null;
	}>;
	schedules?: Schedule[];
	default_repo?: {
		id: string;
		github_repo_name: string;
	} | null;
	_count?: {
		triggers: number;
		schedules: number;
	};
}

// ============================================
// Agents and Models
// ============================================

export * from "./agents";

// ============================================
// Prompts
// ============================================

export * from "./prompts";

// ============================================
// Sandbox Providers (types only - implementations are server-only)
// ============================================

export * from "./sandbox-provider";
// NOTE: Provider implementations are server-only due to Node.js dependencies.
// Import from "@proliferate/shared/providers" in API routes.

// ============================================
// OpenCode Tools
// ============================================

export * from "./opencode-tools";

// ============================================
// Env Parser
// ============================================

export { parseEnvFile, isValidTargetPath, type EnvEntry } from "./env-parser";

// ============================================
// Async Clients
// ============================================

export * from "./async-client";

// ============================================
// API Contracts (ts-rest types)
// ============================================

export * from "./contracts";

// ============================================
// Connectors (MCP)
// ============================================

export * from "./connectors";

// ============================================
// Billing
// ============================================

// NOTE: Billing implementations require server-side access (Redis, Postgres).
// Import from "@proliferate/shared/billing" in API routes and workers.
// Type exports are available from the main package.
