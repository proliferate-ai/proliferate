import { env } from "@proliferate/environment/server";
import { NextResponse } from "next/server";

/**
 * Returns which auth providers are configured.
 * This allows the frontend to conditionally show OAuth buttons.
 */
export async function GET() {
	return NextResponse.json({
		providers: {
			google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
			github: !!(env.GITHUB_OAUTH_APP_ID && env.GITHUB_OAUTH_APP_SECRET),
			email: true, // Always available
		},
	});
}
