import { requireAuth } from "@/lib/auth-helpers";
import { verifyInstallation } from "@/lib/github-app";
import { integrations } from "@proliferate/services";
import { type NextRequest, NextResponse } from "next/server";

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

function sanitizeReturnUrl(returnUrl: string | undefined): string {
	if (!returnUrl) return "/onboarding";

	const trimmed = returnUrl.trim();
	if (!trimmed.startsWith("/")) return "/onboarding";
	if (trimmed.startsWith("//")) return "/onboarding";

	const path = trimmed.split("?")[0] || "";
	const allowedPrefixes = [
		"/onboarding",
		"/device-github",
		"/dashboard",
		"/settings",
		"/preview",
		"/session",
		"/repos",
		"/invite",
	];
	const isAllowed = allowedPrefixes.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);

	return isAllowed ? trimmed : "/onboarding";
}

/**
 * Handle GitHub App installation callback.
 * GitHub redirects here after the user installs the app on their account/org.
 */
export async function GET(request: NextRequest) {
	const baseUrl = getBaseUrl(request);
	const authResult = await requireAuth();
	if ("error" in authResult) {
		// Redirect to login with return URL
		const returnUrl = `${baseUrl}${request.nextUrl.pathname}${request.nextUrl.search}`;
		return NextResponse.redirect(
			new URL(`/login?returnUrl=${encodeURIComponent(returnUrl)}`, baseUrl),
		);
	}

	// Parse state param for returnUrl and targetOrgId (CLI flows pass targetOrgId)
	const stateParam = request.nextUrl.searchParams.get("state");
	let returnUrl = "/onboarding";
	let targetOrgId: string | undefined;

	if (stateParam) {
		try {
			const state = JSON.parse(stateParam);
			returnUrl = state.returnUrl || "/onboarding";
			targetOrgId = state.targetOrgId;
		} catch {
			// Legacy: state is just the returnUrl string
			returnUrl = stateParam;
		}
	}
	returnUrl = sanitizeReturnUrl(returnUrl);

	// Use targetOrgId from state if provided (CLI flow), otherwise use browser's active org
	const orgId = targetOrgId || authResult.session.session.activeOrganizationId;
	console.log(
		"[GitHub Callback] Using orgId:",
		orgId,
		"targetOrgId:",
		targetOrgId,
		"activeOrgId:",
		authResult.session.session.activeOrganizationId,
	);
	if (!orgId) {
		return NextResponse.redirect(new URL("/dashboard?error=no_org", baseUrl));
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

	try {
		// Verify the installation exists and get details
		console.log("[GitHub Callback] Verifying installation:", installationId);
		const installation = await verifyInstallation(installationId);
		console.log("[GitHub Callback] Installation verified:", installation.account.login);

		const displayName = `${installation.account.login} (${installation.account.type})`;
		console.log("[GitHub Callback] Saving integration for org:", orgId);

		// Save the GitHub App installation using the service layer
		const result = await integrations.saveGitHubAppInstallation({
			organizationId: orgId,
			installationId,
			displayName,
			createdBy: authResult.session.user.id,
		});

		if (!result.success) {
			console.error("[GitHub Callback] Failed to save GitHub installation");
			return NextResponse.redirect(new URL("/dashboard?error=save_failed", baseUrl));
		}

		console.log("[GitHub Callback] Integration saved successfully");
		const redirectUrl = new URL(returnUrl, baseUrl);
		redirectUrl.searchParams.set("success", "github");
		return NextResponse.redirect(redirectUrl);
	} catch (error) {
		console.error("GitHub callback error:", error);
		return NextResponse.redirect(new URL("/dashboard?error=github_callback_failed", baseUrl));
	}
}
