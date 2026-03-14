import { z } from "zod";

export const RepoSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	githubOrg: z.string(),
	githubName: z.string(),
	githubRepoName: z.string(), // derived: githubOrg/githubName
	defaultBranch: z.string(),
	defaultSnapshotId: z.string().nullable(),
	connectionSource: z.string(),
	createdAt: z.coerce.date(),
});

export const RepoSnapshotSchema = z.object({
	id: z.string(),
	repoId: z.string(),
	e2bSnapshotId: z.string(),
	createdAt: z.coerce.date(),
	lastRefreshedAt: z.coerce.date().nullable(),
});

export const CreateRepoInputSchema = z.object({
	githubOrg: z.string().min(1),
	githubName: z.string().min(1),
	defaultBranch: z.string().min(1).default("main"),
});
