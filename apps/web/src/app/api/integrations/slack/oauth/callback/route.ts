import { requireAuth } from "@/lib/auth-helpers";
import { encrypt, getEncryptionKey } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { verifySignedOAuthState } from "@/lib/oauth-state";
import { exchangeCodeForToken } from "@/lib/slack";
import { env } from "@proliferate/environment/server";
import { integrations, orgs } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ handler: "slack-oauth-callback" });

interface SlackOAuthState {
	orgId: string;
	userId: string;
	nonce: string;
	timestamp: number;
	returnUrl?: string;
}

function isValidSlackOAuthState(state: unknown): state is SlackOAuthState {
	if (!state || typeof state !== "object" || Array.isArray(state)) {
		return false;
	}

	const stateData = state as Record<string, unknown>;

	return (
		typeof stateData.orgId === "string" &&
		stateData.orgId.length > 0 &&
		typeof stateData.userId === "string" &&
		stateData.userId.length > 0 &&
		typeof stateData.nonce === "string" &&
		stateData.nonce.length > 0 &&
		typeof stateData.timestamp === "number"
	);
}

function getSafeReturnUrl(returnUrl: unknown): string | undefined {
	if (typeof returnUrl !== "string") {
		return undefined;
	}

	const trimmed = returnUrl.trim();
	if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
		return undefined;
	}

	return trimmed;
}

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

	const verifiedState = verifySignedOAuthState<Record<string, unknown>>(state);
	if (!verifiedState.ok) {
		log.warn({ verificationError: verifiedState.error }, "Invalid Slack OAuth state signature");
		return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
	}

	if (!isValidSlackOAuthState(verifiedState.payload)) {
		log.warn("Slack OAuth state payload is missing required fields");
		return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
	}

	const stateData = verifiedState.payload;

	// Use returnUrl from state if provided, otherwise default to settings
	const returnUrl = getSafeReturnUrl(stateData.returnUrl);
	const redirectBase = returnUrl ? `${appUrl}${returnUrl}` : settingsUrl;

	// Check state timestamp (5 minute expiry)
	const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
	if (stateData.timestamp < fiveMinutesAgo) {
		return NextResponse.redirect(`${redirectBase}?error=slack_oauth_expired`);
	}

	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.redirect(`${redirectBase}?error=slack_oauth_unauthorized`);
	}

	const authUserId = authResult.session.user.id;
	if (authUserId !== stateData.userId) {
		log.warn({ authUserId, stateUserId: stateData.userId }, "Slack OAuth state user mismatch");
		return NextResponse.redirect(`${redirectBase}?error=slack_oauth_forbidden`);
	}

	const role = await orgs.getUserRole(authUserId, stateData.orgId);
	if (role !== "owner" && role !== "admin") {
		log.warn(
			{ userId: authUserId, orgId: stateData.orgId, role },
			"User is not an integration admin for OAuth org",
		);
		return NextResponse.redirect(`${redirectBase}?error=slack_oauth_forbidden`);
	}

	const orgId = stateData.orgId;
	const userId = authUserId;

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
