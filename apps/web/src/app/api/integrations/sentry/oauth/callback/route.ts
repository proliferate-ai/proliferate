import { requireAuth } from "@/lib/auth/server/session";
import { sanitizeOAuthReturnUrl, verifySignedOAuthState } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { integrations, orgs } from "@proliferate/services";
import { NextResponse } from "next/server";

interface SentryOAuthState {
	orgId: string;
	userId: string;
	nonce: string;
	timestamp: number;
	returnUrl?: string;
	host?: string;
}

function isValidState(state: unknown): state is SentryOAuthState {
	if (!state || typeof state !== "object" || Array.isArray(state)) return false;
	const value = state as Record<string, unknown>;
	return (
		typeof value.orgId === "string" &&
		typeof value.userId === "string" &&
		typeof value.nonce === "string" &&
		typeof value.timestamp === "number"
	);
}

function sanitizeSentryHost(input: string | undefined): string {
	if (!input) return "sentry.io";
	const host = input.trim().toLowerCase();
	if (!/^[a-z0-9.-]+$/.test(host)) return "sentry.io";
	return host;
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const oauthError = url.searchParams.get("error");
	const appUrl = env.NEXT_PUBLIC_APP_URL;

	if (oauthError) {
		return NextResponse.redirect(`${appUrl}/dashboard/integrations?error=sentry_oauth_denied`);
	}
	if (!code || !state) {
		return NextResponse.redirect(
			`${appUrl}/dashboard/integrations?error=sentry_oauth_missing_params`,
		);
	}

	const verified = verifySignedOAuthState<Record<string, unknown>>(state);
	if (!verified.ok || !isValidState(verified.payload)) {
		return NextResponse.redirect(
			`${appUrl}/dashboard/integrations?error=sentry_oauth_invalid_state`,
		);
	}
	const stateData = verified.payload;
	const returnUrl = sanitizeOAuthReturnUrl(stateData.returnUrl, "/dashboard/integrations");
	const redirectBase = `${appUrl}${returnUrl}`;

	if (stateData.timestamp < Date.now() - 10 * 60 * 1000) {
		return NextResponse.redirect(`${redirectBase}?error=sentry_oauth_expired`);
	}

	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.redirect(`${redirectBase}?error=sentry_oauth_unauthorized`);
	}
	if (authResult.session.user.id !== stateData.userId) {
		return NextResponse.redirect(`${redirectBase}?error=sentry_oauth_forbidden`);
	}
	const role = await orgs.getUserRole(authResult.session.user.id, stateData.orgId);
	if (role !== "owner" && role !== "admin") {
		return NextResponse.redirect(`${redirectBase}?error=sentry_oauth_forbidden`);
	}

	if (!env.SENTRY_OAUTH_CLIENT_ID || !env.SENTRY_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(`${redirectBase}?error=sentry_not_configured`);
	}
	const host = sanitizeSentryHost(stateData.host);
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
		return NextResponse.redirect(`${redirectBase}?error=sentry_oauth_token_failed`);
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
		organizationId: stateData.orgId,
		userId: authResult.session.user.id,
		provider: "sentry",
		connectionId: `sentry:${stateData.orgId}:${userIdPart}`,
		displayName: tokenPayload.user?.name || tokenPayload.user?.email || "Sentry",
		scopes: tokenPayload.scope ? tokenPayload.scope.split(/\s+/).filter(Boolean) : undefined,
		accessToken: tokenPayload.access_token,
		refreshToken: tokenPayload.refresh_token,
		expiresInSeconds: tokenPayload.expires_in,
		tokenType: tokenPayload.token_type ?? null,
		connectionMetadata: { hostname: host, userId: tokenPayload.user?.id ?? null },
	});

	return NextResponse.redirect(`${redirectBase}?success=sentry`);
}
