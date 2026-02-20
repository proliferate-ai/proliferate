/**
 * GET/PUT/PATCH /api/billing/settings
 *
 * DEPRECATED — thin adapter forwarding to the same service-layer methods as oRPC.
 * Use the oRPC `billing.updateSettings` procedure instead.
 * Will be removed after deprecation window (see billing-metering.md §10.6 D3).
 */

import { requireAuth } from "@/lib/auth-helpers";
import { isBillingEnabled } from "@/lib/billing";
import { logger } from "@/lib/logger";
import { getUserOrgRole } from "@/lib/permissions";
import { orgs } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ route: "billing/settings" });

const DEFAULT_BILLING_SETTINGS = {
	overage_policy: "pause" as const,
	overage_cap_cents: null as number | null,
};

const deprecationHeaders = {
	Deprecation: "true",
	Link: '</api/rpc/billing.updateSettings>; rel="successor-version"',
} as const;

export async function GET() {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	if (!isBillingEnabled()) {
		return NextResponse.json(
			{ enabled: false, settings: DEFAULT_BILLING_SETTINGS },
			{ headers: deprecationHeaders },
		);
	}

	const org = await orgs.getBillingInfo(orgId);
	if (!org) {
		log.error("Failed to fetch org");
		return NextResponse.json({ error: "Failed to fetch billing settings" }, { status: 500 });
	}

	return NextResponse.json(
		{
			enabled: true,
			configured: !!org.autumnCustomerId,
			settings: org.billingSettings ?? DEFAULT_BILLING_SETTINGS,
		},
		{ headers: deprecationHeaders },
	);
}

export async function PUT(request: Request) {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	const userId = authResult.session.user.id;

	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	const role = await getUserOrgRole(userId, orgId);
	if (!role || role === "member") {
		return NextResponse.json({ error: "Only admins can update billing settings" }, { status: 403 });
	}

	const body = await request.json();
	const { overage_policy, overage_cap_cents } = body;

	if (overage_policy && !["pause", "allow"].includes(overage_policy)) {
		return NextResponse.json(
			{ error: "Invalid overage_policy. Must be 'pause' or 'allow'" },
			{ status: 400 },
		);
	}

	if (
		overage_cap_cents !== undefined &&
		overage_cap_cents !== null &&
		(typeof overage_cap_cents !== "number" || overage_cap_cents < 0)
	) {
		return NextResponse.json(
			{ error: "Invalid overage_cap_cents. Must be a positive number or null" },
			{ status: 400 },
		);
	}

	const org = await orgs.getBillingInfo(orgId);
	if (!org) {
		return NextResponse.json({ error: "Failed to fetch current settings" }, { status: 500 });
	}

	const currentSettings = org.billingSettings ?? DEFAULT_BILLING_SETTINGS;
	const newSettings = {
		...currentSettings,
		...(overage_policy !== undefined && { overage_policy }),
		...(overage_cap_cents !== undefined && { overage_cap_cents }),
	};

	try {
		await orgs.updateBillingSettings(orgId, newSettings);
	} catch (error) {
		log.error({ err: error }, "Failed to update settings");
		return NextResponse.json({ error: "Failed to update billing settings" }, { status: 500 });
	}

	return NextResponse.json(
		{ success: true, settings: newSettings },
		{ headers: deprecationHeaders },
	);
}

export async function PATCH(request: Request) {
	return PUT(request);
}
