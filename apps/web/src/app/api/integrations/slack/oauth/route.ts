import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/auth-helpers";
import { createSignedOAuthState, sanitizeOAuthReturnUrl } from "@/lib/oauth-state";
import { getSlackOAuthUrl } from "@/lib/slack";
import { orgs } from "@proliferate/services";
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
	const role = await orgs.getUserRole(userId, orgId);
	if (role !== "owner" && role !== "admin") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// Get optional return URL from query params (must be a relative path)
	const { searchParams } = new URL(request.url);
	const rawReturnUrl = searchParams.get("returnUrl") ?? undefined;
	const returnUrl = sanitizeOAuthReturnUrl(rawReturnUrl);

	// Generate state token for CSRF protection
	// Contains org context, nonce, and optional return URL
	const state = createSignedOAuthState({
		orgId,
		userId,
		nonce: randomUUID(),
		timestamp: Date.now(),
		returnUrl,
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
