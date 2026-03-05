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

function sanitizeSentryHost(input: string | undefined): string {
	if (!input) return "sentry.io";
	const host = input.trim().toLowerCase();
	if (!/^[a-z0-9.-]+$/.test(host)) return "sentry.io";
	return host;
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const preflight = parseOAuthCallbackPreflight(request, "sentry");
	if ("response" in preflight) {
		return preflight.response;
	}
	const { code, state } = preflight;

	const verified = verifySignedOAuthState<Record<string, unknown>>(state);
	if (!verified.ok || !isBaseOAuthStatePayload(verified.payload)) {
		return redirectForOAuthCallbackError(
			"sentry",
			OAUTH_CALLBACK_POLICIES.sentry.errors.invalidState,
		);
	}
	const stateData = verified.payload as BaseOAuthStatePayload & {
		returnUrl?: string;
		host?: unknown;
	};
	const callbackContext = await verifyOAuthCallbackContext({
		provider: "sentry",
		state: stateData,
		returnUrl: stateData.returnUrl,
	});
	if ("response" in callbackContext) {
		return callbackContext.response;
	}
	const { orgId, userId, redirectBase } = callbackContext.context;

	if (!env.SENTRY_OAUTH_CLIENT_ID || !env.SENTRY_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.sentry.errors.notConfigured}`,
		);
	}
	const host = sanitizeSentryHost(typeof stateData.host === "string" ? stateData.host : undefined);
	const tokenResponse = await fetch(`https://${host}/oauth/token/`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.SENTRY_OAUTH_CLIENT_ID,
			client_secret: env.SENTRY_OAUTH_CLIENT_SECRET,
			grant_type: "authorization_code",
			code,
			redirect_uri: `${url.origin}/api/integrations/sentry/oauth/callback`,
		}),
	});
	if (!tokenResponse.ok) {
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.sentry.errors.tokenFailed}`,
		);
	}

	const tokenPayload = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
		token_type?: string;
		scope?: string;
		user?: {
			id?: string;
			name?: string;
			email?: string;
		};
	};

	const userIdPart = tokenPayload.user?.id || tokenPayload.user?.email || "default";
	await integrations.saveOAuthAppIntegration({
		organizationId: orgId,
		userId,
		provider: "sentry",
		connectionId: `sentry:${orgId}:${userIdPart}`,
		displayName: tokenPayload.user?.name || tokenPayload.user?.email || "Sentry",
		scopes: tokenPayload.scope ? tokenPayload.scope.split(/\s+/).filter(Boolean) : undefined,
		accessToken: tokenPayload.access_token,
		refreshToken: tokenPayload.refresh_token,
		expiresInSeconds: tokenPayload.expires_in,
		tokenType: tokenPayload.token_type ?? null,
		connectionMetadata: { hostname: host, userId: tokenPayload.user?.id ?? null },
	});

	return NextResponse.redirect(
		`${redirectBase}?success=${OAUTH_CALLBACK_POLICIES.sentry.errors.success}`,
	);
}
