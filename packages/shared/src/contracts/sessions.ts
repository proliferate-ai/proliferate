import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";
import { RepoSchema } from "./repos";

const c = initContract();

// ============================================
// Schemas
// ============================================

export const SessionStatusSchema = z.enum([
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
	sessionType: z.string().nullable(),
	status: z.string().nullable(), // DB returns string, not enum
	sandboxId: z.string().nullable(),
	snapshotId: z.string().nullable(),
	prebuildId: z.string().uuid().nullable(),
	branchName: z.string().nullable(),
	parentSessionId: z.string().nullable(),
	title: z.string().nullable(),
	startedAt: z.string().nullable(),
	lastActivityAt: z.string().nullable(),
	pausedAt: z.string().nullable(),
	origin: z.string().nullable(),
	clientType: z.string().nullable(),
	repo: RepoSchema.optional(),
});

export type Session = z.infer<typeof SessionSchema>;

export const CreateSessionInputSchema = z
	.object({
		prebuildId: z.string().uuid().optional(),
		sessionType: z.enum(["setup", "coding"]).optional(),
		modelId: z.string().optional(),
		/** Integration IDs to associate with the session for OAuth token injection. */
		integrationIds: z.array(z.string().uuid()).optional(),
	})
	.superRefine((data, ctx) => {
		if (data.sessionType === "setup" && !data.prebuildId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Setup sessions require a prebuildId",
				path: ["prebuildId"],
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

// ============================================
// Contract
// ============================================

export const sessionsContract = c.router(
	{
		list: {
			method: "GET",
			path: "/sessions",
			query: z.object({
				repoId: z.string().optional(),
				status: z.string().optional(),
			}),
			responses: {
				200: z.object({ sessions: z.array(SessionSchema) }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List sessions for the current organization",
		},

		get: {
			method: "GET",
			path: "/sessions/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			responses: {
				200: z.object({ session: SessionSchema }),
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get a session by ID",
		},

		create: {
			method: "POST",
			path: "/sessions",
			body: CreateSessionInputSchema,
			responses: {
				200: CreateSessionResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				402: PaymentRequiredErrorSchema,
				500: ErrorResponseSchema,
			},
			summary: "Create a new session from a prebuild",
		},

		delete: {
			method: "DELETE",
			path: "/sessions/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({ deleted: z.boolean() }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Delete a session",
		},

		rename: {
			method: "PATCH",
			path: "/sessions/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: RenameSessionInputSchema,
			responses: {
				200: z.object({ session: SessionSchema }),
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Rename a session",
		},

		pause: {
			method: "POST",
			path: "/sessions/:id/pause",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({
					paused: z.boolean(),
					snapshotId: z.string().nullable(),
				}),
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Pause a running session",
		},

		snapshot: {
			method: "POST",
			path: "/sessions/:id/snapshot",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({ snapshotId: z.string() }),
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Create a snapshot of the session",
		},

		status: {
			method: "GET",
			path: "/sessions/:id/status",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			responses: {
				200: z.object({
					status: z.string(),
					isComplete: z.boolean(),
				}),
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get session status (no auth required)",
		},
	},
	{
		pathPrefix: "/api",
	},
);
