import { requireIntegrationAdminContext } from "@/lib/integrations/oauth-context";
import { buildSignedOAuthStateFromRequest } from "@/lib/integrations/oauth-state";
import { getSlackOAuthUrl } from "@/lib/integrations/slack";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
	const authContext = await requireIntegrationAdminContext(request, {
		unauthenticatedResponse: "json",
	});
	if ("response" in authContext) {
		return authContext.response;
	}

	// Generate state token for CSRF protection
	// Contains org context, nonce, and optional return URL
	const { state, returnUrl } = buildSignedOAuthStateFromRequest({
		request,
		orgId: authContext.context.orgId,
		userId: authContext.context.userId,
	});

	let oauthUrl: string;
	try {
		oauthUrl = getSlackOAuthUrl(state);
	} catch {
		// Missing SLACK_CLIENT_ID or other required env vars
		const base = new URL(request.url).origin;
		const redirect = returnUrl || "/dashboard/integrations";
		return NextResponse.redirect(new URL(`${redirect}?error=slack_not_configured`, base));
	}

	return NextResponse.redirect(oauthUrl);
}
