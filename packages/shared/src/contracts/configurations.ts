import { z } from "zod";

// ============================================
// Schemas
// ============================================

export const ConfigurationRepoSchema = z.object({
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

export const ConfigurationSchema = z.object({
	id: z.string().uuid(),
	snapshotId: z.string().nullable(),
	status: z.string().nullable(),
	name: z.string().nullable(),
	notes: z.string().nullable(),
	routingDescription: z.string().nullable().optional(),
	createdAt: z.string().nullable(),
	createdBy: z.string().nullable(),
	sandboxProvider: z.string().nullable(),
	configurationRepos: z.array(ConfigurationRepoSchema).optional(),
	setupSessions: z.array(SetupSessionSchema).optional(),
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

export const CreateConfigurationInputSchema = z.object({
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

export const UpdateConfigurationInputSchema = z.object({
	name: z.string().optional(),
	notes: z.string().optional(),
	routingDescription: z.string().nullable().optional(),
});
