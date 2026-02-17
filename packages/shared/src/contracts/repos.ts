import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// Schemas
// ============================================

export const GitHubRepoSchema = z.object({
	id: z.number(),
	full_name: z.string(),
	private: z.boolean(),
	clone_url: z.string(),
	html_url: z.string(),
	default_branch: z.string(),
});

export type GitHubRepo = z.infer<typeof GitHubRepoSchema>;

export const SearchRepoSchema = z.object({
	id: z.number(),
	name: z.string(),
	full_name: z.string(),
	html_url: z.string(),
	default_branch: z.string(),
	private: z.boolean(),
	description: z.string().nullable(),
	stargazers_count: z.number(),
	language: z.string().nullable(),
});

export type SearchRepo = z.infer<typeof SearchRepoSchema>;

// Finalize setup input schema
export const FinalizeSetupInputSchema = z.object({
	sessionId: z.string(),
	secrets: z.record(z.string()).optional(),
	name: z.string().optional(),
	notes: z.string().optional(),
	updateSnapshotId: z.string().optional(),
	keepRunning: z.boolean().optional(),
});

export type FinalizeSetupInput = z.infer<typeof FinalizeSetupInputSchema>;

// Finalize setup response schema
export const FinalizeSetupResponseSchema = z.object({
	configurationId: z.string(),
	snapshotId: z.string(),
	success: z.boolean(),
});

export const RepoSchema = z.object({
	id: z.string().uuid(),
	organizationId: z.string(),
	githubRepoId: z.string(),
	githubRepoName: z.string(),
	githubUrl: z.string(),
	defaultBranch: z.string().nullable(),
	createdAt: z.string().nullable(),
	source: z.string(),
	isPrivate: z.boolean(),
});

export type Repo = z.infer<typeof RepoSchema>;

export const CreateRepoInputSchema = z.object({
	githubRepoId: z.string(),
	githubUrl: z.string().url(),
	githubRepoName: z.string(),
	defaultBranch: z.string().optional(),
	integrationId: z.string().optional(),
	isPrivate: z.boolean().optional(),
	source: z.string().optional(),
});

export type CreateRepoInput = z.infer<typeof CreateRepoInputSchema>;

// ============================================
// Contract
// ============================================

export const reposContract = c.router(
	{
		list: {
			method: "GET",
			path: "/repos",
			responses: {
				200: z.object({ repos: z.array(RepoSchema) }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List all repos for the current organization",
		},

		get: {
			method: "GET",
			path: "/repos/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			responses: {
				200: z.object({ repo: RepoSchema }),
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get a single repo by ID",
		},

		create: {
			method: "POST",
			path: "/repos",
			body: CreateRepoInputSchema,
			responses: {
				200: z.object({
					id: z.string().uuid(),
					repo: RepoSchema.partial(),
					existing: z.boolean(),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Add a repo to the organization",
		},

		delete: {
			method: "DELETE",
			path: "/repos/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({ deleted: z.boolean() }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Delete a repo",
		},

		available: {
			method: "GET",
			path: "/repos/available",
			query: z.object({
				integrationId: z.string().optional(),
			}),
			responses: {
				200: z.object({
					repositories: z.array(GitHubRepoSchema),
					integrationId: z.string(),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List available GitHub repositories for an integration",
		},

		search: {
			method: "GET",
			path: "/repos/search",
			query: z.object({
				q: z.string().optional(),
			}),
			responses: {
				200: z.object({
					repositories: z.array(SearchRepoSchema),
				}),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Search public GitHub repositories",
		},
	},
	{
		pathPrefix: "/api",
	},
);
