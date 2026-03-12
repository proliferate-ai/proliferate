import { getBaseUrl, requireIntegrationAdminContext } from "@/lib/integrations/oauth-context";
import { buildSignedOAuthStateFromRequest } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { composio } from "@proliferate/services";
import { CONNECTOR_PRESETS } from "@proliferate/shared";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
	const baseUrl = getBaseUrl(request);

	const authContext = await requireIntegrationAdminContext(request);
	if ("response" in authContext) {
		return authContext.response;
	}

	const toolkit = request.nextUrl.searchParams.get("toolkit");
	if (!toolkit) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?error=composio_oauth_missing_params", baseUrl),
		);
	}

	// Validate toolkit matches a preset
	const preset = CONNECTOR_PRESETS.find((p) => p.composioToolkit === toolkit);
	if (!preset) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?error=composio_oauth_missing_params", baseUrl),
		);
	}

	if (!env.COMPOSIO_API_KEY) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?error=composio_not_configured", baseUrl),
		);
	}

	const { state } = buildSignedOAuthStateFromRequest({
		request,
		orgId: authContext.context.orgId,
		userId: authContext.context.userId,
		defaultReturnUrl: "/dashboard/integrations",
		extraPayload: { toolkit },
	});

	const config: composio.ComposioClientConfig = {
		apiKey: env.COMPOSIO_API_KEY,
		baseUrl: env.COMPOSIO_BASE_URL,
	};

	try {
		const result = await composio.initiateOAuth(config, {
			toolkit,
			orgId: authContext.context.orgId,
			callbackUrl: `${baseUrl}/api/integrations/composio/oauth/callback?state=${encodeURIComponent(state)}`,
		});

		return NextResponse.redirect(result.redirectUrl);
	} catch {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?error=composio_oauth_denied", baseUrl),
		);
	}
}
