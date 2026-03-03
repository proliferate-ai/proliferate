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
