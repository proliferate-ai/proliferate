import {
	OAUTH_CALLBACK_POLICIES,
	parseOAuthCallbackPreflight,
	redirectForOAuthCallbackError,
	verifyOAuthCallbackContext,
} from "@/lib/integrations/oauth-callback";
import {
	type BaseOAuthStatePayload,
	isBaseOAuthStatePayload,
	verifySignedOAuthState,
} from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { integrations } from "@proliferate/services";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
	const callbackUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/integrations/linear/oauth/callback`;
	const preflight = parseOAuthCallbackPreflight(request, "linear");
	if ("response" in preflight) {
		return preflight.response;
	}
	const { code, state } = preflight;

	const verified = verifySignedOAuthState<Record<string, unknown>>(state);
	if (!verified.ok || !isBaseOAuthStatePayload(verified.payload)) {
		return redirectForOAuthCallbackError(
			"linear",
			OAUTH_CALLBACK_POLICIES.linear.errors.invalidState,
		);
	}

	const stateData = verified.payload as BaseOAuthStatePayload & { returnUrl?: string };
	const callbackContext = await verifyOAuthCallbackContext({
		provider: "linear",
		state: stateData,
		returnUrl: stateData.returnUrl,
	});
	if ("response" in callbackContext) {
		return callbackContext.response;
	}
	const { orgId, userId, redirectBase } = callbackContext.context;

	if (!env.LINEAR_OAUTH_CLIENT_ID || !env.LINEAR_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.linear.errors.notConfigured}`,
		);
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
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.linear.errors.tokenFailed}`,
		);
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
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.linear.errors.profileFailed}`,
		);
	}
	const viewerPayload = (await viewerResponse.json()) as {
		data?: { viewer?: { id: string; name?: string | null; email?: string | null } };
	};
	const viewer = viewerPayload.data?.viewer;
	if (!viewer?.id) {
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.linear.errors.profileFailed}`,
		);
	}

	await integrations.saveOAuthAppIntegration({
		organizationId: orgId,
		userId,
		provider: "linear",
		connectionId: `linear:${orgId}:${viewer.id}`,
		displayName: viewer.name || viewer.email || "Linear",
		scopes: tokenPayload.scope ? tokenPayload.scope.split(/[,\s]+/).filter(Boolean) : undefined,
		accessToken: tokenPayload.access_token,
		refreshToken: tokenPayload.refresh_token,
		expiresInSeconds: tokenPayload.expires_in,
		tokenType: tokenPayload.token_type ?? null,
		connectionMetadata: { viewerId: viewer.id, viewerEmail: viewer.email ?? null },
	});

	return NextResponse.redirect(
		`${redirectBase}?success=${OAUTH_CALLBACK_POLICIES.linear.errors.success}`,
	);
}
