import { getBaseUrl, requireIntegrationAdminContext } from "@/lib/integrations/oauth-context";
import { buildSignedOAuthStateFromRequest } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
	const baseUrl = getBaseUrl(request);
	const callbackUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/integrations/linear/oauth/callback`;
	const authContext = await requireIntegrationAdminContext(request);
	if ("response" in authContext) {
		return authContext.response;
	}

	if (!env.LINEAR_OAUTH_CLIENT_ID || !env.LINEAR_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?error=linear_not_configured", baseUrl),
		);
	}

	const { state } = buildSignedOAuthStateFromRequest({
		request,
		orgId: authContext.context.orgId,
		userId: authContext.context.userId,
		defaultReturnUrl: "/dashboard/integrations",
	});

	const authorizeUrl = new URL("https://linear.app/oauth/authorize");
	authorizeUrl.searchParams.set("client_id", env.LINEAR_OAUTH_CLIENT_ID);
	authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("scope", "read,write");
	authorizeUrl.searchParams.set("state", state);

	return NextResponse.redirect(authorizeUrl.toString());
}
