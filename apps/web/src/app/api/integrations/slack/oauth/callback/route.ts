import { encrypt, getEncryptionKey } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { exchangeCodeForToken } from "@/lib/slack";
import { env } from "@proliferate/environment/server";
import { integrations } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ handler: "slack-oauth-callback" });

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const code = searchParams.get("code");
	const state = searchParams.get("state");
	const error = searchParams.get("error");

	const appUrl = env.NEXT_PUBLIC_APP_URL;
	const settingsUrl = `${appUrl}`;

	// Handle OAuth errors from Slack
	if (error) {
		log.error({ error }, "Slack OAuth error");
		return NextResponse.redirect(`${settingsUrl}?error=slack_oauth_denied`);
	}

	if (!code || !state) {
		return NextResponse.redirect(`${settingsUrl}?error=slack_oauth_missing_params`);
	}

	// Decode and validate state
	let stateData: {
		orgId: string;
		userId: string;
		nonce: string;
		timestamp: number;
		returnUrl?: string;
	};
	try {
		stateData = JSON.parse(Buffer.from(state, "base64url").toString());
	} catch {
		return NextResponse.redirect(`${settingsUrl}?error=slack_oauth_invalid_state`);
	}

	// Use returnUrl from state if provided, otherwise default to settings
	const redirectBase = stateData.returnUrl ? `${appUrl}${stateData.returnUrl}` : settingsUrl;

	// Check state timestamp (5 minute expiry)
	const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
	if (stateData.timestamp < fiveMinutesAgo) {
		return NextResponse.redirect(`${redirectBase}?error=slack_oauth_expired`);
	}

	const { orgId, userId } = stateData;

	// Exchange code for token
	const tokenResponse = await exchangeCodeForToken(code);

	if (!tokenResponse.ok) {
		log.error({ error: tokenResponse.error }, "Slack token exchange failed");
		return NextResponse.redirect(`${redirectBase}?error=slack_oauth_token_failed`);
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
		return NextResponse.redirect(`${redirectBase}?error=slack_db_error`);
	}

	log.info(
		{ teamId: tokenResponse.team.id, teamName: tokenResponse.team.name },
		"Slack installation complete",
	);

	return NextResponse.redirect(`${redirectBase}?success=slack&tab=connections`);
}
