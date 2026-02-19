/**
 * GET /api/billing/events
 *
 * DEPRECATED — thin adapter forwarding to the same service-layer methods as oRPC.
 * Will be removed after deprecation window (see billing-metering.md §10.6 D3).
 */

import { requireAuth } from "@/lib/auth-helpers";
import { isBillingEnabled } from "@/lib/billing";
import { logger } from "@/lib/logger";
import { billing } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ route: "billing/events" });

const deprecationHeaders = {
	Deprecation: "true",
} as const;

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
		return NextResponse.json({ enabled: false, events: [] }, { headers: deprecationHeaders });
	}

	const { searchParams } = new URL(request.url);
	const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
	const offset = Number(searchParams.get("offset")) || 0;
	const eventType = searchParams.get("type");
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
		log.error({ err: error }, "Failed to fetch events");
		return NextResponse.json({ error: "Failed to fetch billing events" }, { status: 500 });
	}
	const { events, total } = result;

	return NextResponse.json(
		{
			enabled: true,
			events: events.map((event) => ({
				id: event.id,
				type: event.eventType,
				credits: Number(event.credits),
				quantity: Number(event.quantity),
				sessionIds: event.sessionIds ?? [],
				metadata: event.metadata,
				createdAt:
					event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt,
			})),
			total,
			limit,
			offset,
		},
		{ headers: deprecationHeaders },
	);
}
