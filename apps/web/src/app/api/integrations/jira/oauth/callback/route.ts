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

interface AtlassianResource {
	id: string;
	name: string;
	url: string;
	scopes: string[];
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const preflight = parseOAuthCallbackPreflight(request, "jira");
	if ("response" in preflight) {
		return preflight.response;
	}
	const { code, state } = preflight;

	const verified = verifySignedOAuthState<Record<string, unknown>>(state);
	if (!verified.ok || !isBaseOAuthStatePayload(verified.payload)) {
		return redirectForOAuthCallbackError("jira", OAUTH_CALLBACK_POLICIES.jira.errors.invalidState);
	}
	const stateData = verified.payload as BaseOAuthStatePayload & { returnUrl?: string };
	const callbackContext = await verifyOAuthCallbackContext({
		provider: "jira",
		state: stateData,
		returnUrl: stateData.returnUrl,
	});
	if ("response" in callbackContext) {
		return callbackContext.response;
	}
	const { orgId, userId, redirectBase } = callbackContext.context;
	if (!env.JIRA_OAUTH_CLIENT_ID || !env.JIRA_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.jira.errors.notConfigured}`,
		);
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
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.jira.errors.tokenFailed}`,
		);
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
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.jira.errors.resourcesFailed}`,
		);
	}
	const resources = (await resourcesResponse.json()) as AtlassianResource[];
	const selectedResource = resources[0];
	if (!selectedResource?.id) {
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.jira.errors.noSite}`,
		);
	}

	await integrations.saveOAuthAppIntegration({
		organizationId: orgId,
		userId,
		provider: "jira",
		connectionId: `jira:${orgId}:${selectedResource.id}`,
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

	return NextResponse.redirect(
		`${redirectBase}?success=${OAUTH_CALLBACK_POLICIES.jira.errors.success}`,
	);
}
