import { requireAuth } from "@/lib/auth/server/session";
import { sanitizeOAuthReturnUrl, verifySignedOAuthState } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { integrations, orgs } from "@proliferate/services";
import { NextResponse } from "next/server";

interface JiraOAuthState {
	orgId: string;
	userId: string;
	nonce: string;
	timestamp: number;
	returnUrl?: string;
}

interface AtlassianResource {
	id: string;
	name: string;
	url: string;
	scopes: string[];
}

function isValidState(state: unknown): state is JiraOAuthState {
	if (!state || typeof state !== "object" || Array.isArray(state)) return false;
	const value = state as Record<string, unknown>;
	return (
		typeof value.orgId === "string" &&
		typeof value.userId === "string" &&
		typeof value.nonce === "string" &&
		typeof value.timestamp === "number"
	);
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const oauthError = url.searchParams.get("error");
	const appUrl = env.NEXT_PUBLIC_APP_URL;

	if (oauthError) {
		return NextResponse.redirect(`${appUrl}/dashboard/integrations?error=jira_oauth_denied`);
	}
	if (!code || !state) {
		return NextResponse.redirect(
			`${appUrl}/dashboard/integrations?error=jira_oauth_missing_params`,
		);
	}

	const verified = verifySignedOAuthState<Record<string, unknown>>(state);
	if (!verified.ok || !isValidState(verified.payload)) {
		return NextResponse.redirect(`${appUrl}/dashboard/integrations?error=jira_oauth_invalid_state`);
	}
	const stateData = verified.payload;
	const returnUrl = sanitizeOAuthReturnUrl(stateData.returnUrl, "/dashboard/integrations");
	const redirectBase = `${appUrl}${returnUrl}`;

	if (stateData.timestamp < Date.now() - 10 * 60 * 1000) {
		return NextResponse.redirect(`${redirectBase}?error=jira_oauth_expired`);
	}

	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.redirect(`${redirectBase}?error=jira_oauth_unauthorized`);
	}
	if (authResult.session.user.id !== stateData.userId) {
		return NextResponse.redirect(`${redirectBase}?error=jira_oauth_forbidden`);
	}
	const role = await orgs.getUserRole(authResult.session.user.id, stateData.orgId);
	if (role !== "owner" && role !== "admin") {
		return NextResponse.redirect(`${redirectBase}?error=jira_oauth_forbidden`);
	}
	if (!env.JIRA_OAUTH_CLIENT_ID || !env.JIRA_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(`${redirectBase}?error=jira_not_configured`);
	}

	const tokenResponse = await fetch("https://auth.atlassian.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: env.JIRA_OAUTH_CLIENT_ID,
			client_secret: env.JIRA_OAUTH_CLIENT_SECRET,
			code,
			redirect_uri: `${url.origin}/api/integrations/jira/oauth/callback`,
		}),
	});
	if (!tokenResponse.ok) {
		return NextResponse.redirect(`${redirectBase}?error=jira_oauth_token_failed`);
	}
	const tokenPayload = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
		scope?: string;
		token_type?: string;
	};

	const resourcesResponse = await fetch(
		"https://api.atlassian.com/oauth/token/accessible-resources",
		{
			headers: {
				Authorization: `Bearer ${tokenPayload.access_token}`,
				Accept: "application/json",
			},
		},
	);
	if (!resourcesResponse.ok) {
		return NextResponse.redirect(`${redirectBase}?error=jira_oauth_resources_failed`);
	}
	const resources = (await resourcesResponse.json()) as AtlassianResource[];
	const selectedResource = resources[0];
	if (!selectedResource?.id) {
		return NextResponse.redirect(`${redirectBase}?error=jira_oauth_no_site`);
	}

	await integrations.saveOAuthAppIntegration({
		organizationId: stateData.orgId,
		userId: authResult.session.user.id,
		provider: "jira",
		connectionId: `jira:${stateData.orgId}:${selectedResource.id}`,
		displayName: selectedResource.name || "Jira",
		scopes: selectedResource.scopes?.length
			? selectedResource.scopes
			: tokenPayload.scope?.split(/\s+/).filter(Boolean),
		accessToken: tokenPayload.access_token,
		refreshToken: tokenPayload.refresh_token,
		expiresInSeconds: tokenPayload.expires_in,
		tokenType: tokenPayload.token_type ?? null,
		connectionMetadata: {
			cloudId: selectedResource.id,
			siteName: selectedResource.name,
			siteUrl: selectedResource.url,
		},
	});

	return NextResponse.redirect(`${redirectBase}?success=jira`);
}
