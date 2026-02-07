import { requireAuth } from "@/lib/auth-helpers";
import { SignJWT } from "jose";
import { NextResponse } from "next/server";

const JWT_SECRET = process.env.GATEWAY_JWT_SECRET;
const TOKEN_LIFETIME = "1h";

/**
 * GET /api/auth/ws-token
 *
 * Generates a short-lived JWT for WebSocket authentication to the Gateway.
 * The client exchanges their better-auth session for a JWT the Gateway can verify.
 */
export async function GET() {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	if (!JWT_SECRET) {
		console.error("[ws-token] Missing GATEWAY_JWT_SECRET");
		return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
	}

	const userId = authResult.session.user.id;
	const email = authResult.session.user.email || undefined;

	// Generate JWT that matches sandbox lifetime (1 hour)
	// This ensures the token doesn't expire before the sandbox does
	const token = await new SignJWT({ sub: userId, email })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(TOKEN_LIFETIME)
		.sign(new TextEncoder().encode(JWT_SECRET));

	return NextResponse.json({ token });
}
