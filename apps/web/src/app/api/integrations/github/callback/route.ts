import { requireAuth } from "@/lib/auth-helpers";
import { listInstallationRepos, verifyInstallation } from "@/lib/github-app";
import { logger } from "@/lib/logger";
import { sanitizeOAuthReturnUrl, verifySignedOAuthState } from "@/lib/oauth-state";
import { integrations, orgs, repos } from "@proliferate/services";
import { type NextRequest, NextResponse } from "next/server";

const log = logger.child({ route: "integrations/github/callback" });

interface GitHubOAuthState {
	orgId: string;
	userId: string;
	nonce: string;
	timestamp: number;
	returnUrl?: string;
}

/**
 * Get the base URL for redirects, respecting proxy headers (ngrok, etc.)
 */
function getBaseUrl(request: NextRequest): string {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
	if (forwardedHost) {
		return `${forwardedProto}://${forwardedHost}`;
	}
	return request.nextUrl.origin;
}

function isValidGitHubOAuthState(state: unknown): state is GitHubOAuthState {
	if (!state || typeof state !== "object" || Array.isArray(state)) {
		return false;
	}

	const stateData = state as Record<string, unknown>;

	return (
		typeof stateData.orgId === "string" &&
		stateData.orgId.length > 0 &&
		typeof stateData.userId === "string" &&
		stateData.userId.length > 0 &&
		typeof stateData.nonce === "string" &&
		stateData.nonce.length > 0 &&
		typeof stateData.timestamp === "number"
	);
}

/**
 * Handle GitHub App installation callback.
 * GitHub redirects here after the user installs the app on their account/org.
 */
export async function GET(request: NextRequest) {
	const baseUrl = getBaseUrl(request);
	const authResult = await requireAuth();
	if ("error" in authResult) {
		// Redirect to sign-in with return URL (relative), so the callback can be retried after auth.
		const returnUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`;
		return NextResponse.redirect(
			new URL(`/sign-in?redirect=${encodeURIComponent(returnUrl)}`, baseUrl),
		);
	}

	const installationId = request.nextUrl.searchParams.get("installation_id");
	const setupAction = request.nextUrl.searchParams.get("setup_action");

	if (!installationId) {
		return NextResponse.redirect(new URL("/dashboard?error=no_installation_id", baseUrl));
	}

	// Handle uninstall/suspend
	if (setupAction === "uninstall") {
		return NextResponse.redirect(new URL("/dashboard?github=uninstalled", baseUrl));
	}

	const stateParam = request.nextUrl.searchParams.get("state");
	if (!stateParam) {
		log.warn("Missing GitHub OAuth state");
		return NextResponse.json({ error: "Missing OAuth state" }, { status: 400 });
	}

	const verifiedState = verifySignedOAuthState<Record<string, unknown>>(stateParam);
	if (!verifiedState.ok) {
		log.warn({ verificationError: verifiedState.error }, "Invalid GitHub OAuth state signature");
		return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
	}

	if (!isValidGitHubOAuthState(verifiedState.payload)) {
		log.warn("GitHub OAuth state payload is missing required fields");
		return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
	}

	const stateData = verifiedState.payload;
	const authUserId = authResult.session.user.id;

	if (stateData.userId !== authUserId) {
		log.warn({ authUserId, stateUserId: stateData.userId }, "GitHub OAuth state user mismatch");
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const stateMaxAgeMs = 30 * 60 * 1000;
	if (stateData.timestamp < Date.now() - stateMaxAgeMs) {
		return NextResponse.json({ error: "OAuth state expired" }, { status: 400 });
	}

	const role = await orgs.getUserRole(authUserId, stateData.orgId);
	if (role !== "owner" && role !== "admin") {
		log.warn(
			{ userId: authUserId, orgId: stateData.orgId, role },
			"User is not an integration admin for OAuth org",
		);
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const orgId = stateData.orgId;
	const returnUrl = sanitizeOAuthReturnUrl(stateData.returnUrl, "/onboarding") || "/onboarding";
	log.info(
		{ orgId, activeOrgId: authResult.session.session.activeOrganizationId },
		"Using orgId from verified OAuth state",
	);

	try {
		// Verify the installation exists and get details
		log.info({ installationId }, "Verifying installation");
		const installation = await verifyInstallation(installationId);
		log.info({ account: installation.account.login }, "Installation verified");

		const displayName = `${installation.account.login} (${installation.account.type})`;
		log.info({ orgId }, "Saving integration");

		// Save the GitHub App installation using the service layer
		const result = await integrations.saveGitHubAppInstallation({
			organizationId: orgId,
			installationId,
			displayName,
			createdBy: authResult.session.user.id,
		});

		if (!result.success) {
			log.error("Failed to save GitHub installation");
			return NextResponse.redirect(new URL("/dashboard?error=save_failed", baseUrl));
		}

		log.info("Integration saved successfully");

		// Auto-add all repos from the installation
		if (result.integrationId) {
			try {
				const { repositories } = await listInstallationRepos(installationId);
				log.info({ count: repositories.length }, "Auto-adding repos from installation");

				await Promise.all(
					repositories.map((repo) =>
						repos
							.createRepoWithConfiguration({
								organizationId: orgId,
								userId: authResult.session.user.id,
								githubRepoId: String(repo.id),
								githubRepoName: repo.full_name,
								githubUrl: repo.html_url,
								defaultBranch: repo.default_branch,
								integrationId: result.integrationId,
								isPrivate: repo.private,
								source: "github",
							})
							.catch((err) => {
								log.warn({ err, repoName: repo.full_name }, "Failed to auto-add repo");
							}),
					),
				);

				log.info("Auto-added repos from installation");
			} catch (error) {
				log.warn({ err: error }, "Failed to auto-sync repos, user can add manually");
			}
		} else {
			log.warn("Integration saved but no integrationId returned, skipping repo auto-add");
		}

		const redirectUrl = new URL(returnUrl, baseUrl);
		redirectUrl.searchParams.set("success", "github");
		return NextResponse.redirect(redirectUrl);
	} catch (error) {
		log.error({ err: error }, "GitHub callback error");
		return NextResponse.redirect(new URL("/dashboard?error=github_callback_failed", baseUrl));
	}
}
