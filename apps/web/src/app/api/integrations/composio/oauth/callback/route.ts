import {
	OAUTH_CALLBACK_POLICIES,
	redirectForOAuthCallbackError,
	verifyOAuthCallbackContext,
} from "@/lib/integrations/oauth-callback";
import {
	type BaseOAuthStatePayload,
	isBaseOAuthStatePayload,
	verifySignedOAuthState,
} from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { composio, connectors } from "@proliferate/services";
import { NextResponse } from "next/server";

const policy = OAUTH_CALLBACK_POLICIES.composio;

export async function GET(request: Request) {
	const url = new URL(request.url);

	// Composio returns: status, connected_account_id + our state in the query
	const status = url.searchParams.get("status");
	const connectedAccountId = url.searchParams.get("connected_account_id");
	const stateParam = url.searchParams.get("state");

	if (!stateParam) {
		return redirectForOAuthCallbackError("composio", policy.errors.missingParams);
	}

	// Verify signed state
	const verified = verifySignedOAuthState<Record<string, unknown>>(stateParam);
	if (!verified.ok || !isBaseOAuthStatePayload(verified.payload)) {
		return redirectForOAuthCallbackError("composio", policy.errors.invalidState);
	}

	const stateData = verified.payload as BaseOAuthStatePayload & {
		returnUrl?: string;
		toolkit?: string;
	};
	const toolkit = stateData.toolkit;

	if (!toolkit) {
		return redirectForOAuthCallbackError("composio", policy.errors.invalidState);
	}

	// Auth + role + timestamp check
	const callbackContext = await verifyOAuthCallbackContext({
		provider: "composio",
		state: stateData,
		returnUrl: stateData.returnUrl,
	});
	if ("response" in callbackContext) {
		return callbackContext.response;
	}
	const { orgId, userId, redirectBase } = callbackContext.context;

	// Verify Composio returned success
	if (status !== "success" && status !== "active") {
		return NextResponse.redirect(`${redirectBase}?error=${policy.errors.denied}`);
	}

	if (!connectedAccountId) {
		return NextResponse.redirect(`${redirectBase}?error=${policy.errors.missingParams}`);
	}

	if (!env.COMPOSIO_API_KEY) {
		return NextResponse.redirect(`${redirectBase}?error=${policy.errors.notConfigured}`);
	}

	const config: composio.ComposioClientConfig = {
		apiKey: env.COMPOSIO_API_KEY,
		baseUrl: env.COMPOSIO_BASE_URL,
	};

	// Verify connected account belongs to this org AND matches the requested toolkit
	try {
		const account = await composio.getConnectedAccount(config, connectedAccountId);
		if (!account.userId || account.userId !== orgId) {
			return NextResponse.redirect(`${redirectBase}?error=${policy.errors.forbidden}`);
		}
		// Fail-open: integrationId may be a UUID rather than the toolkit slug
		if (account.integrationId && account.integrationId !== toolkit) {
			return NextResponse.redirect(`${redirectBase}?error=${policy.errors.forbidden}`);
		}
	} catch {
		return NextResponse.redirect(`${redirectBase}?error=${policy.errors.tokenFailed}`);
	}

	// Get or create MCP server URL
	let mcpUrl: string;
	try {
		const mcpResult = await composio.getOrCreateMcpServer(config, { toolkit, orgId });
		mcpUrl = mcpResult.mcpUrl;
	} catch {
		return NextResponse.redirect(`${redirectBase}?error=${policy.errors.tokenFailed}`);
	}

	// Create or update connector
	try {
		await connectors.createComposioConnector({
			organizationId: orgId,
			createdBy: userId,
			toolkit,
			connectedAccountId,
			mcpUrl,
		});
	} catch {
		return NextResponse.redirect(`${redirectBase}?error=${policy.errors.tokenFailed}`);
	}

	return NextResponse.redirect(`${redirectBase}?success=composio_${toolkit}`);
}
