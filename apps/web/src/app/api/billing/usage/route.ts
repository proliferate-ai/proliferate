/**
 * GET /api/billing/usage
 *
 * Get current billing usage and credit balance for the active organization.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { getOrgBillingStatus, isBillingEnabled } from "@/lib/billing";
import { logger } from "@/lib/logger";
import { billing } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ route: "billing/usage" });

export async function GET() {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	// Check if billing is enabled
	if (!isBillingEnabled()) {
		return NextResponse.json({
			enabled: false,
			message: "Billing is not configured",
		});
	}

	const billingStatus = await getOrgBillingStatus(orgId);

	if (!billingStatus.configured) {
		return NextResponse.json({
			enabled: true,
			configured: false,
			message: "Billing not set up for this organization",
		});
	}

	// Get usage breakdown from billing_events
	// Use raw query since billing_events table is not in generated types yet
	let events: Array<{ eventType: string; credits: string }> = [];
	try {
		events = await billing.listPostedEventsSince(
			orgId,
			new Date(new Date().getFullYear(), new Date().getMonth(), 1),
		);
	} catch (error) {
		log.error({ err: error }, "Failed to fetch events");
	}

	// Calculate breakdown
	let computeCredits = 0;
	let llmCredits = 0;

	for (const event of events) {
		if (event.eventType === "compute") {
			computeCredits += Number(event.credits);
		} else if (event.eventType === "llm") {
			llmCredits += Number(event.credits);
		}
	}

	return NextResponse.json({
		enabled: true,
		configured: true,
		plan: billingStatus.plan,
		credits: billingStatus.credits,
		breakdown: {
			compute: Math.round(computeCredits * 100) / 100,
			llm: Math.round(llmCredits * 100) / 100,
		},
		periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
	});
}
