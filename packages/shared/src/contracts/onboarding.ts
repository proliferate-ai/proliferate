import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// Schemas
// ============================================

export const OnboardingRepoSchema = z.object({
	id: z.string().uuid(),
	github_repo_name: z.string(),
	github_url: z.string(),
	default_branch: z.string().nullable(),
	created_at: z.string().nullable(),
	prebuild_id: z.string().nullable(),
	prebuild_status: z.enum(["ready", "pending"]),
});

export type OnboardingRepo = z.infer<typeof OnboardingRepoSchema>;

export const OnboardingStatusSchema = z.object({
	hasOrg: z.boolean(),
	onboardingComplete: z.boolean(),
	hasSlackConnection: z.boolean(),
	hasGitHubConnection: z.boolean(),
	repos: z.array(OnboardingRepoSchema),
	selectedTools: z.array(z.string()).optional(),
});

export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;

export const FinalizeOnboardingInputSchema = z.object({
	selectedGithubRepoIds: z.array(z.number()),
	integrationId: z.string(),
});

export type FinalizeOnboardingInput = z.infer<typeof FinalizeOnboardingInputSchema>;

export const FinalizeOnboardingResponseSchema = z.object({
	prebuildId: z.string(),
	repoIds: z.array(z.string()),
	isNew: z.boolean(),
});

export type FinalizeOnboardingResponse = z.infer<typeof FinalizeOnboardingResponseSchema>;

export const SaveToolSelectionsInputSchema = z.object({
	selectedTools: z.array(z.string()),
});

export type SaveToolSelectionsInput = z.infer<typeof SaveToolSelectionsInputSchema>;

export const SaveQuestionnaireInputSchema = z.object({
	referralSource: z.string().optional(),
	companyWebsite: z.string().optional(),
	teamSize: z.string().optional(),
});

export type SaveQuestionnaireInput = z.infer<typeof SaveQuestionnaireInputSchema>;

// ============================================
// Contract
// ============================================

export const onboardingContract = c.router(
	{
		getStatus: {
			method: "GET",
			path: "/onboarding",
			responses: {
				200: OnboardingStatusSchema,
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get onboarding status for the current user/organization",
		},

		finalize: {
			method: "POST",
			path: "/onboarding/finalize",
			body: FinalizeOnboardingInputSchema,
			responses: {
				200: FinalizeOnboardingResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Finalize onboarding by selecting repos and creating a managed prebuild",
		},
	},
	{
		pathPrefix: "/api",
	},
);
