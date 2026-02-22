import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { requireNangoIntegrationId } from "@/lib/nango";
import { env } from "@proliferate/environment/server";
import { cli } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ route: "cli/auth/device/poll" });

export async function POST(request: Request) {
	let deviceCode: string | null = null;
	try {
		const body = await request.json();
		if (
			body &&
			typeof body === "object" &&
			typeof (body as { deviceCode?: unknown }).deviceCode === "string"
		) {
			deviceCode = (body as { deviceCode: string }).deviceCode;
		}
	} catch {
		// Handle below via null validation.
	}

	if (!deviceCode) {
		return NextResponse.json({ error: "invalid_device_code" }, { status: 400 });
	}

	try {
		const pollResult = await cli.pollDeviceCode(deviceCode);
		if (pollResult.status === "pending") {
			return NextResponse.json({ error: "authorization_pending" });
		}
		if (pollResult.status === "expired") {
			return NextResponse.json({ error: "expired_token" });
		}
		if (pollResult.status === "invalid" || !pollResult.codeData?.user_id) {
			return NextResponse.json({ error: "invalid_device_code" });
		}

		const apiKeyResult = await auth.api.createApiKey({
			body: {
				name: "cli-token",
				userId: pollResult.codeData.user_id,
				expiresIn: undefined,
			},
		});

		const integrationIds = ["github-app"];
		if (env.NEXT_PUBLIC_INTEGRATIONS_ENABLED) {
			integrationIds.push(requireNangoIntegrationId("github"));
		}

		const result = await cli.completeDeviceAuthorization(pollResult.codeData, integrationIds);

		return NextResponse.json({
			token: apiKeyResult.key,
			user: result.user,
			org: result.org,
			hasGitHubConnection: result.hasGitHubConnection,
		});
	} catch (err) {
		log.error({ err }, "Failed polling CLI device code");
		return NextResponse.json({ error: "internal_error" }, { status: 500 });
	}
}
