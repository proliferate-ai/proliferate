/**
 * Gateway WebSocket Protocol Types
 *
 * Message types for Client <-> Gateway WebSocket communication,
 * git operation types, sandbox event types, and session config.
 */

import type {
	SessionOperatorStatus,
	SessionRuntimeStatus,
	SessionVisibility,
} from "../contracts/entities";
import type { AutoStartOutputEntry, ConfigurationServiceCommand } from "../providers/types";

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

// Client -> Gateway messages
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
	commands?: ConfigurationServiceCommand[];
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

// Gateway -> Client messages
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

export interface ControlPlaneSnapshotMessage {
	type: "control_plane_snapshot";
	payload: {
		sessionId: string;
		runtimeStatus: SessionRuntimeStatus | null;
		operatorStatus: SessionOperatorStatus | null;
		capabilitiesVersion: number | null;
		visibility: SessionVisibility | null;
		workerId: string | null;
		workerRunId: string | null;
		sandboxAvailable: boolean;
		reconnectSequence: number;
		emittedAt: string;
	};
}

export interface NotificationMessage {
	type: "notification";
	payload: {
		id: string;
		category: string;
		title: string;
		summary: string;
		severity: string;
		deepLinks: Array<{ label: string; url: string }>;
		sessionId: string | null;
		workerId: string | null;
		runId: string | null;
		createdAt: string;
	};
}

// Daemon stream events forwarded through gateway to workspace panels
export interface DaemonStreamMessage {
	type: "daemon_stream";
	payload: import("../contracts/harness").DaemonStreamEnvelope;
}

export interface WorkspaceStateMessage {
	type: "workspace_state";
	payload: import("../contracts/harness").WorkspaceStateInfo;
}

export interface PortEventMessage {
	type: "port_event";
	payload: {
		action: "opened" | "closed";
		port: number;
		host?: string;
	};
}

export interface FsChangeMessage {
	type: "fs_change";
	payload: {
		action: "write" | "delete" | "rename" | "create";
		path: string;
		size?: number;
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
	| ActionCompletedMessage
	| ControlPlaneSnapshotMessage
	| NotificationMessage
	| DaemonStreamMessage
	| WorkspaceStateMessage
	| PortEventMessage
	| FsChangeMessage;

// Sandbox -> Gateway events
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

// Session config stored in gateway
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
export type ConfigurationStatus = "pending" | "building" | "default" | "ready" | "failed";
