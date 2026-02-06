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

	// Get optional return URL from query params
	const { searchParams } = new URL(request.url);
	const returnUrl = searchParams.get("returnUrl");

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

	const oauthUrl = getSlackOAuthUrl(state);

	return NextResponse.redirect(oauthUrl);
}
