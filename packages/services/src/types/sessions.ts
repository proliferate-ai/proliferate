import type { Session } from "@proliferate/shared/contracts/sessions";

/**
 * Sessions module types.
 *
 * Input types for sessions operations.
 * DB row types are now exported from sessions/db.ts using Drizzle's InferSelectModel.
 */

// ============================================
// Input Types
// ============================================

export interface CreateSessionInput {
	id: string;
	configurationId: string | null;
	organizationId: string;
	sessionType: string;
	status: CreateSessionStatus;
	sandboxProvider: string;

	// Optional fields
	repoId?: string | null;
	createdBy?: string | null;
	snapshotId?: string | null;
	initialPrompt?: string;
	title?: string;
	titleStatus?: string | null;
	clientType?: string;
	clientMetadata?: Record<string, unknown>;
	agentConfig?: Record<string, unknown>;
	automationId?: string | null;
	triggerId?: string | null;
	triggerEventId?: string | null;
	visibility?: "private" | "shared" | "org";
	kind?: "manager" | "task" | "setup" | null;
	// V1: lineage
	continuedFromSessionId?: string | null;
	rerunOfSessionId?: string | null;
}

export interface UpdateSessionInput {
	status?: string;
	sandboxState?: "provisioning" | "running" | "paused" | "terminated" | "failed";
	agentState?: "iterating" | "waiting_input" | "waiting_approval" | "done" | "errored";
	terminalState?: "succeeded" | "failed" | "cancelled" | null;
	stateReason?:
		| "manual_pause"
		| "inactivity"
		| "approval_required"
		| "orphaned"
		| "snapshot_failed"
		| "automation_completed"
		| "credit_limit"
		| "payment_failed"
		| "overage_cap"
		| "suspended"
		| "cancelled_by_user"
		| "runtime_error"
		| null;
	stateUpdatedAt?: string | null;
	sandboxId?: string | null;
	snapshotId?: string | null;
	title?: string;
	titleStatus?: string | null;
	initialPromptSentAt?: string | null;
	openCodeTunnelUrl?: string | null;
	previewTunnelUrl?: string | null;
	codingAgentSessionId?: string | null;
	pausedAt?: string | null;
	pauseReason?: string | null;
	sandboxExpiresAt?: number | null;
	automationId?: string | null;
	triggerId?: string | null;
	triggerEventId?: string | null;
	// Phase 2a: telemetry
	latestTask?: string | null;
	outcome?: "completed" | "succeeded" | "failed" | "needs_human" | null;
	summary?: string | null;
	prUrls?: string[] | null;
	metrics?: {
		toolCalls: number;
		messagesExchanged: number;
		activeSeconds: number;
	} | null;
}

export type CreateSessionStatus =
	| "starting"
	| "pending"
	| "running"
	| "paused"
	| "suspended"
	| "completed"
	| "stopped"
	| "cancelled"
	| "failed";

export interface ListSessionsFilters {
	repoId?: string;
	status?: string;
	kinds?: Array<"manager" | "task" | "setup">;
	limit?: number;
	excludeSetup?: boolean;
	excludeAutomation?: boolean;
	createdBy?: string;
	userId?: string;
	includeArchived?: boolean;
}

// ============================================
// Service Types
// ============================================

export interface ListSessionsOptions {
	repoId?: string;
	status?: string;
	kinds?: Array<"manager" | "task" | "setup">;
	limit?: number;
	excludeSetup?: boolean;
	excludeAutomation?: boolean;
	createdBy?: string;
	userId?: string;
	includeArchived?: boolean;
}

export interface SessionStatus {
	sandboxState: Session["status"]["sandboxState"];
	agentState: Session["status"]["agentState"];
	terminalState: Session["status"]["terminalState"];
	reason: Session["status"]["reason"];
	isTerminal: Session["status"]["isTerminal"];
	agentFinishedIterating: Session["status"]["agentFinishedIterating"];
	requiresHumanReview: Session["status"]["requiresHumanReview"];
	updatedAt: Session["status"]["updatedAt"];
}

/** Input for creating a setup session (for managed configurations). */
export interface CreateSetupSessionInput {
	id: string;
	configurationId: string;
	organizationId: string;
	initialPrompt: string;
}
