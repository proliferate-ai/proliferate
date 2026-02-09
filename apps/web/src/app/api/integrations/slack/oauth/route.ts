import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/auth-helpers";
import { getSlackOAuthUrl } from "@/lib/slack";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	const userId = authResult.session.user.id;

	// Get optional return URL from query params (must be a relative path)
	const { searchParams } = new URL(request.url);
	const rawReturnUrl = searchParams.get("returnUrl");
	const returnUrl =
		rawReturnUrl?.startsWith("/") && !rawReturnUrl.startsWith("//") ? rawReturnUrl : null;

	// Generate state token for CSRF protection
	// Contains org context, nonce, and optional return URL
	const state = Buffer.from(
		JSON.stringify({
			orgId,
			userId,
			nonce: randomUUID(),
			timestamp: Date.now(),
			returnUrl: returnUrl || undefined,
		}),
	).toString("base64url");

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
