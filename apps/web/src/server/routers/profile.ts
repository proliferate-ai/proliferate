/**
 * Profile oRPC router.
 *
 * Git identity management — lets users link their GitHub account
 * so sandbox commits are attributed to them.
 */

import { ORPCError } from "@orpc/server";
import { users } from "@proliferate/services";
import { z } from "zod";
import { protectedProcedure } from "./middleware";

const GITHUB_API = "https://api.github.com";

const GitIdentitySchema = z.object({
	gitName: z.string().nullable(),
	gitEmail: z.string().nullable(),
	githubLinked: z.boolean(),
	githubUsername: z.string().nullable(),
	hasRepoScope: z.boolean(),
});

export const profileRouter = {
	/**
	 * Returns the user's current git identity configuration.
	 */
	gitIdentity: protectedProcedure
		.input(z.object({}).optional())
		.output(GitIdentitySchema)
		.handler(async ({ context }) => {
			const userId = context.user.id;

			const [user, ghAccount] = await Promise.all([
				users.findById(userId),
				users.getGitHubAccount(userId),
			]);

			if (!user) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}

			const scopes = ghAccount?.scope?.split(/[,\s]+/).filter(Boolean) ?? [];

			return {
				gitName: user.gitName ?? null,
				gitEmail: user.gitEmail ?? null,
				githubLinked: Boolean(ghAccount),
				githubUsername: ghAccount?.accountId ?? null,
				hasRepoScope: scopes.includes("repo"),
			};
		}),

	/**
	 * Manually set git identity override.
	 */
	updateGitIdentity: protectedProcedure
		.input(z.object({ gitName: z.string().min(1), gitEmail: z.string().email() }))
		.output(z.object({ gitName: z.string(), gitEmail: z.string() }))
		.handler(async ({ input, context }) => {
			await users.setGitIdentity(context.user.id, input.gitName, input.gitEmail);
			return { gitName: input.gitName, gitEmail: input.gitEmail };
		}),

	/**
	 * Clear git identity override (revert to user.name/email).
	 */
	clearGitIdentity: protectedProcedure
		.input(z.object({}).optional())
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ context }) => {
			await users.clearGitIdentity(context.user.id);
			return { success: true };
		}),

	/**
	 * Sync git identity from linked GitHub account.
	 *
	 * Reads the access token from the better-auth account table,
	 * calls GitHub API to fetch the user's profile + noreply email,
	 * and saves to user.gitName/gitEmail.
	 */
	syncFromGitHub: protectedProcedure
		.input(z.object({}).optional())
		.output(z.object({ gitName: z.string(), gitEmail: z.string() }))
		.handler(async ({ context }) => {
			const ghAccount = await users.getGitHubAccount(context.user.id);
			if (!ghAccount?.accessToken) {
				throw new ORPCError("PRECONDITION_FAILED", {
					message: "No GitHub account linked. Connect GitHub first.",
				});
			}

			const headers = {
				Authorization: `Bearer ${ghAccount.accessToken}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			};

			// Fetch profile and emails in parallel
			const [profileRes, emailsRes] = await Promise.all([
				fetch(`${GITHUB_API}/user`, { headers }),
				fetch(`${GITHUB_API}/user/emails`, { headers }),
			]);

			if (!profileRes.ok) {
				throw new ORPCError("PRECONDITION_FAILED", {
					message: "GitHub token is invalid or expired. Please re-connect GitHub.",
				});
			}

			const profile = (await profileRes.json()) as {
				login: string;
				name: string | null;
				id: number;
			};

			// Build noreply email: {id}+{username}@users.noreply.github.com
			let gitEmail = `${profile.id}+${profile.login}@users.noreply.github.com`;

			// Try to use the primary verified email if available
			if (emailsRes.ok) {
				const emails = (await emailsRes.json()) as Array<{
					email: string;
					primary: boolean;
					verified: boolean;
				}>;
				const primaryEmail = emails.find((e) => e.primary && e.verified);
				if (primaryEmail) {
					gitEmail = primaryEmail.email;
				}
			}

			const gitName = profile.name || profile.login;

			await users.setGitIdentity(context.user.id, gitName, gitEmail);

			return { gitName, gitEmail };
		}),
};
