import { z } from "zod";

export const SessionSchema = z.object({
	id: z.string(),
	repoId: z.string(),
	organizationId: z.string(),
	createdBy: z.string().nullable(),
	state: z.string(),
	sessionType: z.string(),
	harnessType: z.string(),
	sandboxId: z.string().nullable(),
	previewUrl: z.string().nullable(),
	agentBaseUrl: z.string().nullable(),
	devtoolsBaseUrl: z.string().nullable(),
	sandboxAgentId: z.string().nullable(),
	initialPrompt: z.string().nullable(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
	endedAt: z.coerce.date().nullable(),
	repo: z
		.object({
			githubOrg: z.string(),
			githubName: z.string(),
		})
		.nullable(),
});
