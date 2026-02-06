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
	prebuildId: string;
	organizationId: string;
	sessionType: string;
	status: string;
	sandboxProvider: string;

	// Optional fields
	createdBy?: string | null;
	snapshotId?: string | null;
	initialPrompt?: string;
	title?: string;
	clientType?: string;
	clientMetadata?: Record<string, unknown>;
	agentConfig?: Record<string, unknown>;
	localPathHash?: string;
	origin?: string;
	automationId?: string | null;
	triggerId?: string | null;
	triggerEventId?: string | null;
}

export interface UpdateSessionInput {
	status?: string;
	sandboxId?: string | null;
	snapshotId?: string | null;
	title?: string;
	openCodeTunnelUrl?: string | null;
	previewTunnelUrl?: string | null;
	codingAgentSessionId?: string | null;
	pausedAt?: string | null;
	sandboxExpiresAt?: number | null;
	automationId?: string | null;
	triggerId?: string | null;
	triggerEventId?: string | null;
}

export interface ListSessionsFilters {
	repoId?: string;
	status?: string;
}

// ============================================
// Service Types
// ============================================

export interface ListSessionsOptions {
	repoId?: string;
	status?: string;
}

export interface SessionStatus {
	status: string;
	isComplete: boolean;
}

/** Input for creating a setup session (for managed prebuilds). */
export interface CreateSetupSessionInput {
	id: string;
	prebuildId: string;
	organizationId: string;
	initialPrompt: string;
}
