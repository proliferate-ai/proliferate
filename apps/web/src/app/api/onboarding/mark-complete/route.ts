/**
 * POST /api/onboarding/mark-complete
 *
 * Mark the organization's onboarding as complete.
 * Called after Stripe checkout completes.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { orgs } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ route: "onboarding/mark-complete" });

export async function POST() {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	try {
		await orgs.markOnboardingComplete(orgId, true);
	} catch (error) {
		log.error({ err: error }, "Failed to mark onboarding complete");
		return NextResponse.json({ error: "Failed to complete onboarding" }, { status: 500 });
	}

	return NextResponse.json({ success: true });
}
