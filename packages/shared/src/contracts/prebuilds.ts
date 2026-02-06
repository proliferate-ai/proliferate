import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// Schemas
// ============================================

export const PrebuildRepoSchema = z.object({
	workspacePath: z.string(),
	repo: z
		.object({
			id: z.string(),
			githubRepoName: z.string(),
			githubUrl: z.string(),
		})
		.nullable(),
});

export const SetupSessionSchema = z.object({
	id: z.string(),
	sessionType: z.string().nullable(),
	status: z.string().nullable(),
});

export const PrebuildSchema = z.object({
	id: z.string().uuid(),
	snapshotId: z.string().nullable(),
	status: z.string().nullable(),
	name: z.string().nullable(),
	notes: z.string().nullable(),
	createdAt: z.string().nullable(),
	createdBy: z.string().nullable(),
	sandboxProvider: z.string().nullable(),
	prebuildRepos: z.array(PrebuildRepoSchema).optional(),
	setupSessions: z.array(SetupSessionSchema).optional(),
});

export type Prebuild = z.infer<typeof PrebuildSchema>;

export const CreatePrebuildInputSchema = z.object({
	repoIds: z.array(z.string().uuid()).optional(),
	// Legacy format support
	repos: z
		.array(
			z.object({
				repoId: z.string(),
				workspacePath: z.string().optional(),
			}),
		)
		.optional(),
	name: z.string().optional(),
});

export const UpdatePrebuildInputSchema = z.object({
	name: z.string().optional(),
	notes: z.string().optional(),
});

// ============================================
// Contract
// ============================================

export const prebuildsContract = c.router(
	{
		list: {
			method: "GET",
			path: "/prebuilds",
			query: z.object({
				status: z.string().optional(),
			}),
			responses: {
				200: z.object({ prebuilds: z.array(PrebuildSchema) }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List prebuilds for the current organization",
		},

		create: {
			method: "POST",
			path: "/prebuilds",
			body: CreatePrebuildInputSchema,
			responses: {
				200: z.object({
					prebuildId: z.string().uuid(),
					repos: z.number(),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Create a new prebuild with multiple repos",
		},

		update: {
			method: "PATCH",
			path: "/prebuilds/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: UpdatePrebuildInputSchema,
			responses: {
				200: z.object({ prebuild: PrebuildSchema }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Update a prebuild (name, notes)",
		},

		delete: {
			method: "DELETE",
			path: "/prebuilds/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({ success: z.boolean() }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Delete a prebuild",
		},
	},
	{
		pathPrefix: "/api",
	},
);
