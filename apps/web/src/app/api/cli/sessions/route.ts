import { requireAuth } from "@/lib/auth-helpers";
import { GATEWAY_URL } from "@/lib/gateway";
import { logger } from "@/lib/logger";
import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

const log = logger.child({ route: "cli/sessions" });

const SERVICE_TOKEN = env.SERVICE_TO_SERVICE_AUTH_TOKEN;

/**
 * POST /api/cli/sessions
 *
 * Creates a CLI session via the gateway SDK.
 * The gateway handles:
 * - Finding or creating device-scoped prebuild
 * - Finding or creating local repo record
 * - Linking repo to prebuild
 * - Creating session with type "cli"
 *
 * Body:
 * - localPathHash: string (device-scoped hash from CLI)
 * - displayName?: string (directory name for UI)
 */
export async function POST(request: Request) {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	const body = await request.json();
	const { localPathHash, displayName } = body as {
		localPathHash: string;
		displayName?: string;
	};

	if (!localPathHash) {
		return NextResponse.json({ error: "localPathHash is required" }, { status: 400 });
	}

	try {
		// Get the CLI token from the request to pass to gateway
		const headersList = await headers();
		const authorization = headersList.get("authorization");
		const token = authorization?.replace("Bearer ", "") || "";

		// Create gateway client with CLI token
		if (!token && !SERVICE_TOKEN) {
			return NextResponse.json(
				{ error: "SERVICE_TO_SERVICE_AUTH_TOKEN not configured" },
				{ status: 500 },
			);
		}

		const gateway = createSyncClient({
			baseUrl: GATEWAY_URL,
			auth: token
				? { type: "token", token }
				: { type: "service", name: "web-cli-api", secret: SERVICE_TOKEN },
		});

		// Create session via gateway SDK
		const result = await gateway.createSession({
			organizationId: orgId,
			cliPrebuild: { localPathHash, displayName },
			sessionType: "cli",
			clientType: "cli",
			sandboxMode: "deferred", // Gateway will start sandbox on first connect
		});

		return NextResponse.json({
			sessionId: result.sessionId,
			prebuildId: result.prebuildId,
			gatewayUrl: result.gatewayUrl,
			hasSnapshot: result.hasSnapshot,
		});
	} catch (err) {
		log.error({ err }, "Failed to create CLI session");
		const message = err instanceof Error ? err.message : "Unknown error";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
