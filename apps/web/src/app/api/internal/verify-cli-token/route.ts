import { auth } from "@/lib/auth";
import { env } from "@proliferate/environment/server";
import { cli } from "@proliferate/services";
import { NextResponse } from "next/server";

/**
 * POST /api/internal/verify-cli-token
 *
 * Verify a CLI API key and return user info.
 * Used by the gateway to authenticate CLI passthrough requests.
 *
 * Request: { token: string }
 * Response: { valid: true, userId: string, orgId?: string } | { valid: false, error: string }
 */
export async function POST(request: Request) {
	console.log("[verify-cli-token] Received request");

	// Verify internal service token
	const serviceToken = request.headers.get("x-service-token");
	const expectedToken = env.SERVICE_TO_SERVICE_AUTH_TOKEN;
	console.log("[verify-cli-token] Service token match:", serviceToken === expectedToken);

	if (serviceToken !== expectedToken) {
		console.log("[verify-cli-token] Service token mismatch");
		return NextResponse.json({ valid: false, error: "Unauthorized" }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { token } = body as { token?: string };

		if (!token) {
			return NextResponse.json({ valid: false, error: "Missing token" }, { status: 400 });
		}

		// Verify the API key using better-auth
		console.log(
			"[verify-cli-token] Token received:",
			JSON.stringify(token.slice(0, 30)),
			"length:",
			token.length,
		);
		const result = await auth.api.verifyApiKey({
			body: { key: token },
		});
		console.log("[verify-cli-token] API key result:", {
			valid: result.valid,
			hasKey: !!result.key,
		});

		if (!result.valid || !result.key) {
			console.log("[verify-cli-token] API key invalid");
			return NextResponse.json({ valid: false, error: "Invalid token" });
		}

		const userId = result.key.userId;

		// Get the user's active organization
		const orgId = await cli.getUserFirstOrganization(userId);

		return NextResponse.json({
			valid: true,
			userId,
			orgId,
		});
	} catch (error) {
		console.error("CLI token verification failed:", error);
		return NextResponse.json({ valid: false, error: "Verification failed" }, { status: 500 });
	}
}
