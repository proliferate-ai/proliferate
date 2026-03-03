import { z } from "zod";

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
	configurationId: z.string().uuid().nullable().optional(),
	configurationStatus: z.string().nullable().optional(),
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
