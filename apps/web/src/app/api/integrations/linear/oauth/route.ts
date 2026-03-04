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

export async function GET(request: NextRequest) {
	const baseUrl = getBaseUrl(request);
	const callbackUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/integrations/linear/oauth/callback`;
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

	if (!env.LINEAR_OAUTH_CLIENT_ID || !env.LINEAR_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?error=linear_not_configured", baseUrl),
		);
	}

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
	});

	const authorizeUrl = new URL("https://linear.app/oauth/authorize");
	authorizeUrl.searchParams.set("client_id", env.LINEAR_OAUTH_CLIENT_ID);
	authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("scope", "read,write");
	authorizeUrl.searchParams.set("state", state);

	return NextResponse.redirect(authorizeUrl.toString());
}
