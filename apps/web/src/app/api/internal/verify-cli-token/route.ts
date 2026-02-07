import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { env } from "@proliferate/environment/server";
import { cli } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ route: "internal/verify-cli-token" });

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
	// Verify internal service token
	const serviceToken = request.headers.get("x-service-token");
	const expectedToken = env.SERVICE_TO_SERVICE_AUTH_TOKEN;

	if (serviceToken !== expectedToken) {
		return NextResponse.json({ valid: false, error: "Unauthorized" }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { token } = body as { token?: string };

		if (!token) {
			return NextResponse.json({ valid: false, error: "Missing token" }, { status: 400 });
		}

		// Verify the API key using better-auth
		const result = await auth.api.verifyApiKey({
			body: { key: token },
		});

		if (!result.valid || !result.key) {
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
		log.error({ err: error }, "CLI token verification failed");
		return NextResponse.json({ valid: false, error: "Verification failed" }, { status: 500 });
	}
}
