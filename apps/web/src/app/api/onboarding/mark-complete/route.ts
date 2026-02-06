/**
 * POST /api/onboarding/mark-complete
 *
 * Mark the organization's onboarding as complete.
 * Called after Stripe checkout completes.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { orgs } from "@proliferate/services";
import { NextResponse } from "next/server";

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
		console.error("[Onboarding] Failed to mark complete:", error);
		return NextResponse.json({ error: "Failed to complete onboarding" }, { status: 500 });
	}

	return NextResponse.json({ success: true });
}
