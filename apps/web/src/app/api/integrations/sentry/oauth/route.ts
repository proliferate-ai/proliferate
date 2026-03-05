import { getBaseUrl, requireIntegrationAdminContext } from "@/lib/integrations/oauth-context";
import { buildSignedOAuthStateFromRequest } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { type NextRequest, NextResponse } from "next/server";

function sanitizeSentryHost(input: string | undefined): string {
	if (!input) return "sentry.io";
	const host = input.trim().toLowerCase();
	if (!/^[a-z0-9.-]+$/.test(host)) return "sentry.io";
	return host;
}

export async function GET(request: NextRequest) {
	const baseUrl = getBaseUrl(request);
	const authContext = await requireIntegrationAdminContext(request);
	if ("response" in authContext) {
		return authContext.response;
	}
	if (!env.SENTRY_OAUTH_CLIENT_ID || !env.SENTRY_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?error=sentry_not_configured", baseUrl),
		);
	}

	const host = sanitizeSentryHost(request.nextUrl.searchParams.get("host") ?? undefined);
	const { state } = buildSignedOAuthStateFromRequest({
		request,
		orgId: authContext.context.orgId,
		userId: authContext.context.userId,
		defaultReturnUrl: "/dashboard/integrations",
		extraPayload: { host },
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
