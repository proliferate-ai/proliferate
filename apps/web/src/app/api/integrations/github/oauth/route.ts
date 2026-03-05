import { requireIntegrationAdminContext } from "@/lib/integrations/oauth-context";
import { buildSignedOAuthStateFromRequest } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
	const authContext = await requireIntegrationAdminContext(request, { allowTargetOrgId: true });
	if ("response" in authContext) {
		return authContext.response;
	}

	const { state } = buildSignedOAuthStateFromRequest({
		request,
		orgId: authContext.context.orgId,
		userId: authContext.context.userId,
	});

	const installUrl = new URL(
		`https://github.com/apps/${env.NEXT_PUBLIC_GITHUB_APP_SLUG}/installations/new`,
	);
	installUrl.searchParams.set("state", state);
	return NextResponse.redirect(installUrl.toString());
}
