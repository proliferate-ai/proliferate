/**
 * POST /api/sessions/[id]/refresh-token
 *
 * Refresh a billing token for a running session.
 * Called by the sandbox when the token is near expiry.
 */

import { sessions } from "@proliferate/services";
import {
	extractBillingToken,
	mintBillingToken,
	verifyBillingToken,
} from "@proliferate/shared/billing";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id: sessionId } = await params;

	// Extract token from Authorization header
	const authHeader = request.headers.get("Authorization");
	const token = extractBillingToken(authHeader);
	if (!token) {
		return NextResponse.json({ error: "Missing billing token" }, { status: 401 });
	}

	try {
		// Verify the current token (checks signature, expiry, but NOT DB state yet)
		const claims = await verifyBillingToken(token);

		// Ensure the token is for this session
		if (claims.session_id !== sessionId) {
			return NextResponse.json({ error: "Token/session mismatch" }, { status: 403 });
		}

		const session = await sessions.findByIdInternal(sessionId);
		if (!session) {
			return NextResponse.json({ error: "Session not found" }, { status: 404 });
		}

		// Session must still be running
		if (session.status !== "running") {
			return NextResponse.json(
				{ error: `Cannot refresh token for ${session.status} session` },
				{ status: 400 },
			);
		}

		// Verify org matches
		if (session.organizationId !== claims.org_id) {
			return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
		}

		// Check token version (for revocation)
		if (session.billingTokenVersion !== claims.token_version) {
			return NextResponse.json({ error: "Token has been revoked" }, { status: 401 });
		}

		// Issue new token with same version
		const newToken = await mintBillingToken(
			claims.org_id,
			claims.session_id,
			session.billingTokenVersion,
		);

		return NextResponse.json({ token: newToken });
	} catch (err) {
		console.error("[RefreshToken] Error:", err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Invalid token" },
			{ status: 401 },
		);
	}
}
