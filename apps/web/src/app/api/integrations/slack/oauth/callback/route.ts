import { logger } from "@/lib/infra/logger";
import {
	OAUTH_CALLBACK_POLICIES,
	parseOAuthCallbackPreflight,
	verifyOAuthCallbackContext,
} from "@/lib/integrations/oauth-callback";
import {
	type BaseOAuthStatePayload,
	isBaseOAuthStatePayload,
	sanitizeOAuthReturnUrl,
	verifySignedOAuthState,
} from "@/lib/integrations/oauth-state";
import { exchangeCodeForToken } from "@/lib/integrations/slack";
import { integrations } from "@proliferate/services";
import { encrypt, getEncryptionKey } from "@proliferate/shared/crypto";
import { NextResponse } from "next/server";

const log = logger.child({ handler: "slack-oauth-callback" });

export async function GET(request: Request) {
	const preflight = parseOAuthCallbackPreflight(request, "slack");
	if ("response" in preflight) {
		return preflight.response;
	}
	const { code, state } = preflight;

	const verifiedState = verifySignedOAuthState<Record<string, unknown>>(state);
	if (!verifiedState.ok) {
		log.warn({ verificationError: verifiedState.error }, "Invalid Slack OAuth state signature");
		return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
	}

	if (!isBaseOAuthStatePayload(verifiedState.payload)) {
		log.warn("Slack OAuth state payload is missing required fields");
		return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
	}

	const stateData = verifiedState.payload as BaseOAuthStatePayload & { returnUrl?: string };
	// Keep existing behavior: if returnUrl is missing/invalid, redirect to app root.
	const returnUrl = sanitizeOAuthReturnUrl(stateData.returnUrl);
	const callbackContext = await verifyOAuthCallbackContext({
		provider: "slack",
		state: stateData,
		returnUrl,
	});
	if ("response" in callbackContext) {
		return callbackContext.response;
	}

	const { orgId, userId, redirectBase } = callbackContext.context;

	// Exchange code for token
	const tokenResponse = await exchangeCodeForToken(code);

	if (!tokenResponse.ok) {
		log.error({ error: tokenResponse.error }, "Slack token exchange failed");
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.slack.errors.tokenFailed}`,
		);
	}

	// Encrypt bot token
	const encryptionKey = getEncryptionKey();
	const encryptedToken = encrypt(tokenResponse.access_token, encryptionKey);

	try {
		await integrations.saveSlackInstallation({
			organizationId: orgId,
			userId,
			teamId: tokenResponse.team.id,
			teamName: tokenResponse.team.name,
			encryptedBotToken: encryptedToken,
			botUserId: tokenResponse.bot_user_id,
			scopes: tokenResponse.scope.split(","),
		});
	} catch (dbError) {
		log.error({ err: dbError }, "Failed to save Slack installation");
		return NextResponse.redirect(
			`${redirectBase}?error=${OAUTH_CALLBACK_POLICIES.slack.errors.dbError}`,
		);
	}

	log.info(
		{ teamId: tokenResponse.team.id, teamName: tokenResponse.team.name },
		"Slack installation complete",
	);

	return NextResponse.redirect(
		`${redirectBase}?success=${OAUTH_CALLBACK_POLICIES.slack.errors.success}&tab=connections`,
	);
}
