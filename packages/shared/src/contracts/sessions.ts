import { z } from "zod";
import { RepoSchema } from "./repos";

// ============================================
// Schemas
// ============================================

export const SessionStatusSchema = z.enum([
	"pending",
	"starting",
	"running",
	"paused",
	"suspended",
	"stopped",
]);

export const SessionOriginSchema = z.enum(["web", "cli"]).nullable();

export const SessionSchema = z.object({
	id: z.string().uuid(),
	repoId: z.string().uuid().nullable(),
	organizationId: z.string(),
	createdBy: z.string().nullable(),
	kind: z.enum(["manager", "task", "setup"]).nullable().optional(),
	sessionType: z.string().nullable(),
	status: z.string().nullable(), // DB returns string, not enum
	runtimeStatus: z.string().nullable().optional(),
	operatorStatus: z.string().nullable().optional(),
	sandboxId: z.string().nullable(),
	snapshotId: z.string().nullable(),
	configurationId: z.string().uuid().nullable(),
	configurationName: z.string().nullable(),
	branchName: z.string().nullable(),
	parentSessionId: z.string().nullable(),
	title: z.string().nullable(),
	titleStatus: z.string().nullable(),
	startedAt: z.string().nullable(),
	lastActivityAt: z.string().nullable(),
	pausedAt: z.string().nullable(),
	pauseReason: z.string().nullable().optional(),
	origin: z.string().nullable(),
	clientType: z.string().nullable(),
	automationId: z.string().uuid().nullable().optional(),
	automation: z
		.object({
			id: z.string().uuid(),
			name: z.string(),
		})
		.nullable()
		.optional(),
	slackThreadUrl: z.string().nullable().optional(),
	repo: RepoSchema.optional(),
	endedAt: z.string().nullable().optional(),
	promptSnippet: z.string().nullable().optional(),
	initialPrompt: z.string().nullable().optional(),
	// Phase 2a: session telemetry
	outcome: z.enum(["completed", "succeeded", "failed", "needs_human"]).nullable().optional(),
	summary: z.string().nullable().optional(),
	prUrls: z.array(z.string()).nullable().optional(),
	metrics: z
		.object({
			toolCalls: z.number(),
			messagesExchanged: z.number(),
			activeSeconds: z.number(),
		})
		.nullable()
		.optional(),
	latestTask: z.string().nullable().optional(),
	// V1: enrichment fields
	workerId: z.string().uuid().nullable().optional(),
	workerName: z.string().nullable().optional(),
	visibility: z.enum(["private", "shared", "org"]).nullable().optional(),
	continuedFromSessionId: z.string().uuid().nullable().optional(),
	rerunOfSessionId: z.string().uuid().nullable().optional(),
	unread: z.boolean().optional(),
	pendingApprovalCount: z.number().optional(),
});

export type Session = z.infer<typeof SessionSchema>;

export const CreateSessionInputSchema = z
	.object({
		configurationId: z.string().uuid().optional(),
		sessionType: z.enum(["setup", "coding"]).optional(),
		modelId: z.string().optional(),
		/** Reasoning effort level for models that support it. */
		reasoningEffort: z.enum(["quick", "normal", "deep"]).optional(),
		/** Integration IDs to associate with the session for OAuth token injection. */
		integrationIds: z.array(z.string().uuid()).optional(),
		/** Initial prompt text to persist for display and first-send fallback. */
		initialPrompt: z.string().optional(),
	})
	.superRefine((data, ctx) => {
		if (data.sessionType === "setup" && !data.configurationId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Setup sessions require a configurationId",
				path: ["configurationId"],
			});
		}
	});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

export const IntegrationWarningSchema = z.object({
	integrationId: z.string(),
	message: z.string(),
});

export const CreateSessionResponseSchema = z.object({
	sessionId: z.string().uuid(),
	doUrl: z.string(),
	tunnelUrl: z.string().nullable().optional(),
	previewUrl: z.string().nullable().optional(),
	sandboxId: z.string().nullable().optional(),
	warning: z.string().nullable().optional(),
	/** Warnings for integrations that failed token resolution. */
	integrationWarnings: z.array(IntegrationWarningSchema).optional(),
});

export const PaymentRequiredErrorSchema = z.object({
	error: z.string(),
	code: z.string(),
	message: z.string(),
	upgradeUrl: z.literal("/settings/billing"),
});

export const RenameSessionInputSchema = z.object({
	title: z.string(),
});

// V1 canonical session contracts
export const SESSION_KINDS = ["manager", "task", "setup"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_RUNTIME_STATUSES = [
	"starting",
	"running",
	"paused",
	"completed",
	"failed",
	"cancelled",
] as const;
export type SessionRuntimeStatus = (typeof SESSION_RUNTIME_STATUSES)[number];

export const TERMINAL_SESSION_RUNTIME_STATUSES: readonly SessionRuntimeStatus[] = [
	"completed",
	"failed",
	"cancelled",
];
export const NON_TERMINAL_SESSION_RUNTIME_STATUSES: readonly SessionRuntimeStatus[] = [
	"starting",
	"running",
	"paused",
];

const SESSION_RUNTIME_TRANSITIONS: Record<string, readonly SessionRuntimeStatus[]> = {
	starting: ["running", "failed", "cancelled"],
	running: ["paused", "completed", "failed", "cancelled"],
	paused: ["running", "failed", "cancelled"],
};

export function isValidSessionRuntimeTransition(
	from: SessionRuntimeStatus,
	to: SessionRuntimeStatus,
): boolean {
	return SESSION_RUNTIME_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalSessionRuntimeStatus(status: SessionRuntimeStatus): boolean {
	return TERMINAL_SESSION_RUNTIME_STATUSES.includes(status);
}

export function isNonTerminalSessionRuntimeStatus(status: SessionRuntimeStatus): boolean {
	return NON_TERMINAL_SESSION_RUNTIME_STATUSES.includes(status);
}

export const SESSION_OPERATOR_STATUSES = [
	"active",
	"waiting_for_approval",
	"needs_input",
	"ready_for_review",
	"errored",
	"done",
] as const;
export type SessionOperatorStatus = (typeof SESSION_OPERATOR_STATUSES)[number];

const SESSION_OPERATOR_TRANSITIONS: Record<string, readonly SessionOperatorStatus[]> = {
	active: ["waiting_for_approval", "needs_input", "ready_for_review", "errored", "done"],
	waiting_for_approval: ["active", "needs_input", "ready_for_review", "errored", "done"],
	needs_input: ["active", "waiting_for_approval", "ready_for_review", "errored", "done"],
	ready_for_review: ["active", "waiting_for_approval", "needs_input", "errored", "done"],
	errored: ["active", "done"],
};

export function isValidSessionOperatorTransition(
	from: SessionOperatorStatus,
	to: SessionOperatorStatus,
): boolean {
	return SESSION_OPERATOR_TRANSITIONS[from]?.includes(to) ?? false;
}

export const SESSION_MESSAGE_DIRECTIONS = [
	"user_to_manager",
	"user_to_task",
	"manager_to_task",
	"task_to_manager",
] as const;
export type SessionMessageDirection = (typeof SESSION_MESSAGE_DIRECTIONS)[number];

export const SESSION_MESSAGE_DELIVERY_STATES = [
	"queued",
	"delivered",
	"consumed",
	"failed",
] as const;
export type SessionMessageDeliveryState = (typeof SESSION_MESSAGE_DELIVERY_STATES)[number];

export const SESSION_VISIBILITIES = ["private", "shared", "org"] as const;
export type SessionVisibility = (typeof SESSION_VISIBILITIES)[number];

export const SESSION_ACL_ROLES = ["viewer", "editor", "reviewer"] as const;
export type SessionAclRole = (typeof SESSION_ACL_ROLES)[number];

export const SESSION_EVENT_TYPES = [
	"session_created",
	"session_started",
	"session_paused",
	"session_resumed",
	"session_completed",
	"session_failed",
	"session_cancelled",
	"session_outcome_persisted",
] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export const PULL_REQUEST_STATES = ["open", "closed", "merged", "draft"] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

export interface SessionOutcome {
	summary: string | null;
	changedFileCount: number;
	topChangedFiles: string[];
	testSummary: {
		ran: number;
		passed: number;
		failed: number;
		skipped: number;
	} | null;
	pullRequest: {
		url: string;
		number: number;
		state: PullRequestState;
		branch: string;
	} | null;
	errorCode: string | null;
	errorMessage: string | null;
}
