import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth/server/session";
import { createSignedOAuthState, sanitizeOAuthReturnUrl } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { orgs } from "@proliferate/services";
import { type NextRequest, NextResponse } from "next/server";

function getBaseUrl(request: NextRequest): string {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
	if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
	return request.nextUrl.origin;
}

function sanitizeSentryHost(input: string | undefined): string {
	if (!input) return "sentry.io";
	const host = input.trim().toLowerCase();
	if (!/^[a-z0-9.-]+$/.test(host)) return "sentry.io";
	return host;
}

export async function GET(request: NextRequest) {
	const baseUrl = getBaseUrl(request);
	const authResult = await requireAuth();
	if ("error" in authResult) {
		const returnUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`;
		return NextResponse.redirect(
			new URL(`/sign-in?redirect=${encodeURIComponent(returnUrl)}`, baseUrl),
		);
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}
	const role = await orgs.getUserRole(authResult.session.user.id, orgId);
	if (role !== "owner" && role !== "admin") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	if (!env.SENTRY_OAUTH_CLIENT_ID || !env.SENTRY_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?error=sentry_not_configured", baseUrl),
		);
	}

	const host = sanitizeSentryHost(request.nextUrl.searchParams.get("host") ?? undefined);
	const returnUrl = sanitizeOAuthReturnUrl(
		request.nextUrl.searchParams.get("returnUrl") ?? undefined,
		"/dashboard/integrations",
	);
	const state = createSignedOAuthState({
		orgId,
		userId: authResult.session.user.id,
		nonce: randomUUID(),
		timestamp: Date.now(),
		returnUrl,
		host,
	});

	const authorizeUrl = new URL(`https://${host}/oauth/authorize/`);
	authorizeUrl.searchParams.set("client_id", env.SENTRY_OAUTH_CLIENT_ID);
	authorizeUrl.searchParams.set(
		"redirect_uri",
		`${baseUrl}/api/integrations/sentry/oauth/callback`,
	);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("scope", "org:read project:read event:read event:write");
	authorizeUrl.searchParams.set("state", state);

	return NextResponse.redirect(authorizeUrl.toString());
}
