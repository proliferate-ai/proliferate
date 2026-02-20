/**
 * Gateway SDK Shared Types
 */

import type { ClientSource, ServerMessage } from "@proliferate/shared";

/**
 * Options for establishing a WebSocket connection
 */
export interface ConnectionOptions {
	onEvent: (event: ServerMessage) => void;
	onOpen?: () => void;
	onClose?: (code: number, reason?: string) => void;
	onReconnect?: (attempt: number) => void;
	onReconnectFailed?: () => void;
}

/**
 * Reconnection configuration options
 */
export interface ReconnectOptions {
	/** Maximum reconnection attempts (default: 10) */
	maxAttempts?: number;
	/** Base delay in ms (default: 1000) */
	baseDelay?: number;
	/** Maximum delay in ms (default: 30000) */
	maxDelay?: number;
	/** Backoff multiplier (default: 2) */
	backoffMultiplier?: number;
}

/**
 * Options for posting a message
 */
export interface PostMessageOptions {
	content: string;
	userId: string;
	/** Images as data URIs (e.g., "data:image/png;base64,ABC...") */
	images?: string[];
	/** Source of the message (set automatically by client) */
	source?: ClientSource;
	/** Optional idempotency key for safe retries */
	idempotencyKey?: string;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
	ok: boolean;
	latencyMs?: number;
}

/**
 * Sandbox info returned by gateway
 */
export interface SandboxInfo {
	sessionId: string;
	sandboxId: string;
	status: string;
	previewUrl?: string;
	sshHost?: string;
	sshPort?: number;
	expiresAt?: string;
}

/**
 * HTTP client interface for making authenticated requests
 */
export interface HttpClient {
	get<T>(path: string): Promise<T>;
	post<T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T>;
}

/**
 * Session status returned by gateway for finalizer checks
 */
export interface SessionStatusResponse {
	state: "running" | "terminated";
	status: string;
	terminatedAt?: string;
	reason?: string;
	/** Provider sandbox ID (if session has one) */
	sandboxId?: string;
	/** Whether the sandbox is alive at the provider level (null = unknown/check failed) */
	sandboxAlive?: boolean | null;
}

// ============================================
// Session Creation Types
// ============================================

export type SessionType = "coding" | "setup" | "cli";
export type ClientType = "web" | "slack" | "cli" | "automation";
export type SandboxMode = "immediate" | "deferred";

/**
 * Request to create a new session
 */
export interface CreateSessionRequest {
	organizationId: string;

	// Configuration resolution (exactly one required)
	configurationId?: string;
	managedConfiguration?: { repoIds?: string[] };
	cliConfiguration?: { localPathHash: string; displayName?: string };

	// Session config
	sessionType: SessionType;
	clientType: ClientType;
	clientMetadata?: Record<string, unknown>;

	// Options
	sandboxMode?: SandboxMode;
	snapshotId?: string;
	initialPrompt?: string;
	title?: string;
	agentConfig?: { modelId?: string };
	automationId?: string;
	triggerId?: string;
	triggerEventId?: string;
	/** Trigger context written to .proliferate/trigger-context.json in sandbox */
	triggerContext?: Record<string, unknown>;

	// SSH access (can be enabled on any session type)
	sshOptions?: {
		publicKeys: string[];
		localPath?: string;
		gitToken?: string;
		envVars?: Record<string, string>;
	};
}

/**
 * Response from session creation
 */
export interface CreateSessionResponse {
	sessionId: string;
	configurationId: string;
	status: "pending" | "starting" | "running";
	gatewayUrl: string;
	hasSnapshot: boolean;
	isNewConfiguration: boolean;
	sandbox?: {
		sandboxId: string;
		previewUrl: string | null;
		sshHost?: string;
		sshPort?: number;
	};
}
