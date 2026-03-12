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
const ACCOUNT_BINDING_RETRY_MS = 300;
const ACCOUNT_BINDING_MAX_ATTEMPTS = 6;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBoundConnectedAccount(
	config: composio.ComposioClientConfig,
	connectedAccountId: string,
	expected: {
		orgId: string;
		toolkit: string;
	},
): Promise<
	| { status: "matched"; account: composio.ComposioConnectedAccount }
	| { status: "mismatched"; account: composio.ComposioConnectedAccount }
	| { status: "unresolved"; account: composio.ComposioConnectedAccount | null }
> {
	let lastAccount: composio.ComposioConnectedAccount | null = null;

	for (let attempt = 0; attempt < ACCOUNT_BINDING_MAX_ATTEMPTS; attempt += 1) {
		const account = await composio.getConnectedAccount(config, connectedAccountId);
		lastAccount = account;

		const userMatches = account.userId === expected.orgId;
		const userKnown = typeof account.userId === "string" && account.userId.length > 0;
		const toolkitKnown = typeof account.toolkitSlug === "string" && account.toolkitSlug.length > 0;
		const toolkitMatches = account.toolkitSlug === expected.toolkit;

		if ((userKnown && !userMatches) || (toolkitKnown && !toolkitMatches)) {
			return { status: "mismatched", account };
		}

		if (userMatches && toolkitMatches) {
			return { status: "matched", account };
		}

		if (attempt < ACCOUNT_BINDING_MAX_ATTEMPTS - 1) {
			await sleep(ACCOUNT_BINDING_RETRY_MS);
		}
	}

	return { status: "unresolved", account: lastAccount };
}

export async function GET(request: Request) {
	const url = new URL(request.url);

	// Composio returns: status, connected_account_id + our state in the query
	const status = url.searchParams.get("status")?.toLowerCase();
	const connectedAccountId =
		url.searchParams.get("connected_account_id") ?? url.searchParams.get("connectedAccountId");
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
		toolkit?: unknown;
	};
	const toolkit = typeof stateData.toolkit === "string" ? stateData.toolkit : undefined;

	if (!toolkit) {
		return redirectForOAuthCallbackError("composio", policy.errors.invalidState);
	}

	// Auth + role + timestamp check
	const callbackContext = await verifyOAuthCallbackContext({
		provider: "composio",
		state: stateData,
		returnUrl: stateData.returnUrl,
		allowDifferentUserSameOrg: true,
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
	let mcpUrl: string;
	try {
		const binding = await waitForBoundConnectedAccount(config, connectedAccountId, {
			orgId,
			toolkit,
		});
		if (binding.status === "mismatched") {
			return NextResponse.redirect(`${redirectBase}?error=${policy.errors.forbidden}`);
		}
		if (binding.status !== "matched") {
			return NextResponse.redirect(`${redirectBase}?error=${policy.errors.tokenFailed}`);
		}
		const { account } = binding;

		const mcpResult = await composio.getOrCreateMcpServer(config, {
			toolkit,
			orgId,
			authConfigId: account.authConfigId,
			connectedAccountId,
		});
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
