import { NextResponse } from "next/server";

/**
 * Returns which auth providers are configured.
 * This allows the frontend to conditionally show OAuth buttons.
 */
export async function GET() {
	return NextResponse.json({
		providers: {
			google: true,
			github: true,
			email: true, // Always available
		},
	});
}
