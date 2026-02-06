/**
 * GET /api/billing/events
 *
 * Get billing event history for the active organization.
 * Returns paginated list of billing events with session attribution.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { isBillingEnabled } from "@/lib/billing";
import { billing } from "@proliferate/services";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	if (!isBillingEnabled()) {
		return NextResponse.json({
			enabled: false,
			events: [],
		});
	}

	const { searchParams } = new URL(request.url);
	const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
	const offset = Number(searchParams.get("offset")) || 0;
	const eventType = searchParams.get("type"); // 'compute' | 'llm'
	const sessionId = searchParams.get("sessionId");

	let result: Awaited<ReturnType<typeof billing.listBillingEvents>>;
	try {
		result = await billing.listBillingEvents({
			orgId,
			limit,
			offset,
			status: "posted",
			eventType: eventType ?? undefined,
			sessionId: sessionId ?? undefined,
		});
	} catch (error) {
		console.error("[Billing] Failed to fetch events:", error);
		return NextResponse.json({ error: "Failed to fetch billing events" }, { status: 500 });
	}
	const { events, total } = result;

	return NextResponse.json({
		enabled: true,
		events: events.map((e) => ({
			id: e.id,
			type: e.eventType,
			credits: Number(e.credits),
			quantity: Number(e.quantity),
			sessionIds: e.sessionIds ?? [],
			metadata: e.metadata,
			createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
		})),
		total,
		limit,
		offset,
	});
}
