import { getBaseUrl, requireIntegrationAdminContext } from "@/lib/integrations/oauth-context";
import { buildSignedOAuthStateFromRequest } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
	const baseUrl = getBaseUrl(request);
	const authContext = await requireIntegrationAdminContext(request);
	if ("response" in authContext) {
		return authContext.response;
	}

	if (!env.JIRA_OAUTH_CLIENT_ID || !env.JIRA_OAUTH_CLIENT_SECRET) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?error=jira_not_configured", baseUrl),
		);
	}

	const { state } = buildSignedOAuthStateFromRequest({
		request,
		orgId: authContext.context.orgId,
		userId: authContext.context.userId,
		defaultReturnUrl: "/dashboard/integrations",
	});

	const authorizeUrl = new URL("https://auth.atlassian.com/authorize");
	authorizeUrl.searchParams.set("audience", "api.atlassian.com");
	authorizeUrl.searchParams.set("client_id", env.JIRA_OAUTH_CLIENT_ID);
	authorizeUrl.searchParams.set("redirect_uri", `${baseUrl}/api/integrations/jira/oauth/callback`);
	authorizeUrl.searchParams.set(
		"scope",
		"read:jira-user read:jira-work write:jira-work offline_access",
	);
	authorizeUrl.searchParams.set("state", state);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("prompt", "consent");

	return NextResponse.redirect(authorizeUrl.toString());
}
