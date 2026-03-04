import { requireAuth } from "@/lib/auth/server/session";
import { sanitizeOAuthReturnUrl, verifySignedOAuthState } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { integrations, orgs } from "@proliferate/services";
import { NextResponse } from "next/server";

interface LinearOAuthState {
	orgId: string;
	userId: string;
	nonce: string;
	timestamp: number;
	returnUrl?: string;
}

function isValidState(state: unknown): state is LinearOAuthState {
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
	const callbackUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/integrations/linear/oauth/callback`;
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const oauthError = url.searchParams.get("error");
	const appUrl = env.NEXT_PUBLIC_APP_URL;

	if (oauthError) {
		return NextResponse.redirect(`${appUrl}/dashboard/integrations?error=linear_oauth_denied`);
	}
	if (!code || !state) {
		return NextResponse.redirect(
			`${appUrl}/dashboard/integrations?error=linear_oauth_missing_params`,
		);
	}

	const verified = verifySignedOAuthState<Record<string, unknown>>(state);
	if (!verified.ok || !isValidState(verified.payload)) {
		return NextResponse.redirect(
			`${appUrl}/dashboard/integrations?error=linear_oauth_invalid_state`,
		);
	}
	const stateData = verified.payload;
	const returnUrl = sanitizeOAuthReturnUrl(stateData.returnUrl, "/dashboard/integrations");
	const redirectBase = `${appUrl}${returnUrl}`;

	if (stateData.timestamp < Date.now() - 10 * 60 * 1000) {
		return NextResponse.redirect(`${redirectBase}?error=linear_oauth_expired`);
	}

	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.redirect(`${redirectBase}?error=linear_oauth_unauthorized`);
	}

	if (authResult.session.user.id !== stateData.userId) {
		return NextResponse.redirect(`${redirectBase}?error=linear_oauth_forbidden`);
	}

	const role = await orgs.getUserRole(authResult.session.user.id, stateData.orgId);
	if (role !== "owner" && role !== "admin") {
		return NextResponse.redirect(`${redirectBase}?error=linear_oauth_forbidden`);
	}

	if (!env.LINEAR_OAUTH_CLIENT_ID || !env.LINEAR_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(`${redirectBase}?error=linear_not_configured`);
	}

	const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: callbackUrl,
			client_id: env.LINEAR_OAUTH_CLIENT_ID,
			client_secret: env.LINEAR_OAUTH_CLIENT_SECRET,
		}),
	});
	if (!tokenResponse.ok) {
		return NextResponse.redirect(`${redirectBase}?error=linear_oauth_token_failed`);
	}

	const tokenPayload = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
		scope?: string;
		token_type?: string;
	};

	const viewerResponse = await fetch("https://api.linear.app/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${tokenPayload.access_token}`,
		},
		body: JSON.stringify({
			query: "query Viewer { viewer { id name email } }",
		}),
	});
	if (!viewerResponse.ok) {
		return NextResponse.redirect(`${redirectBase}?error=linear_oauth_profile_failed`);
	}
	const viewerPayload = (await viewerResponse.json()) as {
		data?: { viewer?: { id: string; name?: string | null; email?: string | null } };
	};
	const viewer = viewerPayload.data?.viewer;
	if (!viewer?.id) {
		return NextResponse.redirect(`${redirectBase}?error=linear_oauth_profile_failed`);
	}

	await integrations.saveOAuthAppIntegration({
		organizationId: stateData.orgId,
		userId: authResult.session.user.id,
		provider: "linear",
		connectionId: `linear:${stateData.orgId}:${viewer.id}`,
		displayName: viewer.name || viewer.email || "Linear",
		scopes: tokenPayload.scope ? tokenPayload.scope.split(/[,\s]+/).filter(Boolean) : undefined,
		accessToken: tokenPayload.access_token,
		refreshToken: tokenPayload.refresh_token,
		expiresInSeconds: tokenPayload.expires_in,
		tokenType: tokenPayload.token_type ?? null,
		connectionMetadata: { viewerId: viewer.id, viewerEmail: viewer.email ?? null },
	});

	return NextResponse.redirect(`${redirectBase}?success=linear`);
}
